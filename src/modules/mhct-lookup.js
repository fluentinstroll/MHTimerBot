const fetch = require('node-fetch');
const Logger = require('../modules/logger');
const { DateTime, Duration } = require('luxon');
const { calculateRate, prettyPrintArrayAsString, intToHuman } = require('../modules/format-utils');
const { getSearchedEntity } = require('../modules/search-helpers');
const { MessageEmbed } = require('discord.js');

const refresh_rate = Duration.fromObject({ minutes: 5 });
const refresh_list = {
    mouse: DateTime.utc().minus(refresh_rate),
    loot: DateTime.utc().minus(refresh_rate),
    filter: DateTime.utc().minus(refresh_rate),
};
const intervals = [];
const filters = [],
    mice = [],
    loot = [];
let someone_initialized = 0;

const emojis = [
    { id: '1%E2%83%A3', text: ':one:' },
    { id: '2%E2%83%A3', text: ':two:' },
    { id: '3%E2%83%A3', text: ':three:' },
    { id: '4%E2%83%A3', text: ':four:' },
    { id: '5%E2%83%A3', text: ':five:' },
    { id: '6%E2%83%A3', text: ':six:' },
    { id: '7%E2%83%A3', text: ':seven:' },
    { id: '8%E2%83%A3', text: ':eight:' },
    { id: '9%E2%83%A3', text: ':nine:' },
    { id: '%F0%9F%94%9F', text: ':keycap_ten:' },
];


/**
 * Construct and dispatch a reaction-enabled message for interactive "search result" display.
 *
 * @param {DatabaseEntity[]} searchResults An ordered array of objects that resulted from a search.
 * @param {TextChannel} channel The channel on which the client received the find request.
 * @param {Function} dataCallback a Promise-returning function that converts the local entity data into the desired text response.
 * @param {boolean} isDM Whether the response will be to a private message (i.e. if the response can be spammy).
 * @param {{qsParams: Object <string, string>, uri: string, type: string}} urlInfo Information about the query that returned the given matches, including querystring parameters, uri, and the type of search.
 * @param {string} searchInput a lower-cased representation of the user's input.
 */
async function sendInteractiveSearchResult(searchResults, channel, dataCallback, isDM, urlInfo, searchInput) {
    // Associate each search result with a "numeric" emoji.
    searchResults.slice(0, emojis.length);
    const matches = searchResults.map((sr, i) => ({ emojiId: emojis[i].id, match: sr }));
    // Construct a MessageEmbed with the search result information, unless this is for a PM with a single response.
    const embed = new MessageEmbed({
        title: `Search Results for '${searchInput}'`,
        thumbnail: { url: 'https://cdn.discordapp.com/emojis/359244526688141312.png' }, // :clue:
        footer: { text: `For any reaction you select, I'll ${isDM ? 'send' : 'PM'} you that information.` },
    });

    // Pre-compute the url prefix & suffix for each search result. Assumption: single-valued querystring params.
    const urlPrefix = `${urlInfo.uri}?${urlInfo.type}=`;
    const urlSuffix = Object.keys(urlInfo.qsParams).reduce((acc, key) => `${acc}&${key}=${urlInfo.qsParams[key]}`, '');
    // Generate the description to include the reaction, name, and link to HTML data on @devjacksmith's website.
    const description = matches.reduce((acc, entity, i) => {
        const url = `${urlPrefix}${entity.match.id}${urlSuffix}`;
        const row = `\n\t${emojis[i].text}:\t[${entity.match.value}](${url})`;
        return acc + row;
    }, `I found ${matches.length === 1 ? 'a single result' : `${matches.length} good results`}:`);
    embed.setDescription(description);

    const searchResponse = (isDM && matches.length === 1)
        ? `I found a single result for '${searchInput}':`
        : embed;
    const sent = channel.send(searchResponse);
    // To ensure a sensible order of emojis, we have to await the previous react's resolution.
    if (!isDM || matches.length > 1)
        sent.then(async (msg) => {
            /** @type MessageReaction[] */
            const mrxns = [];
            for (const m of matches)
                mrxns.push(await msg.react(m.emojiId).catch(err => Logger.error(err)));
            return mrxns;
        }).then(msgRxns => {
            // Set a 5-minute listener on the message for these reactions.
            const msg = msgRxns[0].message,
                allowed = msgRxns.map(mr => mr.emoji.name),
                filter = (reaction, user) => allowed.includes(reaction.emoji.name) && !user.bot,
                rc = msg.createReactionCollector(filter, { time: 5 * 60 * 1000 });
            rc.on('collect', (mr, user) => {
                // Fetch the response and send it to the user.
                const match = matches.filter(m => m.emojiId === mr.emoji.identifier)[0];
                if (match) dataCallback(true, match.match, urlInfo.qsParams).then(
                    result => user.send(result || `Not enough quality data for ${searchInput}`, { split: { prepend: '```', append: '```' } }),
                    result => user.send(result || 'Not enough quality data to display this'),
                ).catch(err => Logger.error(err));
            }).on('end', () => rc.message.delete().catch(() => Logger.log('Unable to delete reaction message')));
        }).catch(err => Logger.error('Reactions: error setting reactions:\n', err));

    // Always send one result to the channel.
    sent.then(() => dataCallback(isDM, matches[0].match, urlInfo.qsParams).then(
        result => channel.send(result || `Not enough quality data for ${searchInput}`, { split: { prepend: '```\n', append: '\n```' } }),
        result => channel.send(result)),
    ).catch(err => Logger.error(err));
}

/**
 * Formats loot into a nice table
 * @param {boolean} isDM Whether the command came as a DM
 * @param {Object} loot A loot object - it has an id and a value
 * @param {Object} opts Options property. It has filter and DM information
 * @returns {Promise<string>} Formatted loot table
 */
async function formatLoot(isDM, loot, opts) {
    const results = await findThing('loot', loot.id, opts);
    const no_stage = ' N/A ';
    const target_url = `<https://www.agiletravels.com/loot.php?item=${loot.id}&timefilter=${opts.timefilter ? opts.timefilter : 'all_time'}>`;
    const drops = results.filter(loot => loot.total_catches > 99)
        .map(loot => {
            return {
                location: loot.location.substring(0, 20),
                stage: loot.stage === null ? no_stage : loot.stage.substring(0, 20),
                cheese: loot.cheese.substring(0,15),
                total_catches: intToHuman(loot.total_catches),
                dr: calculateRate(loot.total_catches, loot.total_drops),
                pct: loot.drop_pct,
            };
        });
    if (!drops.length)
        return `There were no results with 100 or more catches for ${loot.value}, see more at ${target_url}`;
    const order = ['location', 'stage', 'cheese', 'pct', 'dr', 'total_catches'];
    const labels = { location: 'Location', stage: 'Stage', total_catches: 'Catches',
        dr: '/Catch', cheese: 'Cheese', pct: 'Chance' };
    //Sort the results
    drops.sort((a, b) => parseFloat(b.dr) - parseFloat(a.dr));
    drops.splice(isDM ? 100 : 10);
    if (drops.every(row => row.stage === no_stage))
        order.splice(order.indexOf('stage'), 1);
    // Column Formatting specification.
    /** @type {Object <string, ColumnFormatOptions>} */
    const columnFormatting = {};
    const headers = order.map(key => {
        columnFormatting[key] = {
            columnWidth: labels[key].length,
            alignRight: !isNaN(parseInt(drops[0][key], 10)),
        };
        return { 'key': key, 'label': labels[key] };
    });
    // Give the numeric column proper formatting.
    // TODO: toLocaleString - can it replace integerComma too?
    columnFormatting['dr'] = {
        alignRight: true,
        isFixedWidth: true,
        columnWidth: 7,
    };
    columnFormatting['pct'] = {
        alignRight: true,
        isFixedWidth: true,
        suffix: '%',
        columnWidth: 7,
    };
    let reply = `${loot.value} (loot) can be found the following ways:\n\`\`\``;
    reply += prettyPrintArrayAsString(drops, columnFormatting, headers, '=');
    reply += '```\n' + `HTML version at: ${target_url}`;
    return reply;
}


/**
 * Formats mice into a nice table
 * @param {boolean} isDM Whether the command came as a DM
 * @param {Object} loot A mouse object - it has an id and a value
 * @param {Object} opts Options property. It has filter and DM information
 * @returns {Promise<string>} Formatted mouse AR table
 */
async function formatMice(isDM, mouse, opts) {
    const results = await findThing('mouse', mouse.id, opts);
    const no_stage = ' N/A ';
    const target_url = `<https://www.agiletravels.com/attractions.php?mouse=${mouse.id}&timefilter=${opts.timefilter ? opts.timefilter : 'all_time'}>`;
    const attracts = results.filter(mouse => mouse.total_hunts > 99)
        .map(mice => {
            return {
                location: mice.location.substring(0, 20),
                stage: mice.stage === null ? no_stage : mice.stage.substring(0, 20),
                cheese: mice.cheese.substring(0,15),
                total_hunts: intToHuman(mice.total_hunts),
                ar: mice.rate / 100,
            };
        });
    if (!attracts.length)
        return `There were no results with 100 or more hunts for ${mouse.value}, see more at ${target_url}`;
    const order = ['location', 'stage', 'cheese', 'ar', 'total_hunts'];
    const labels = { location: 'Location', stage: 'Stage', total_hunts: 'Hunts',
        ar: '/Hunt', cheese: 'Cheese' };
    //Sort the results
    attracts.sort((a, b) => parseFloat(b.ar) - parseFloat(a.ar));
    attracts.splice(isDM ? 100 : 10);
    if (attracts.every(row => row.stage === no_stage))
        order.splice(order.indexOf('stage'), 1);
    // Column Formatting specification.
    /** @type {Object <string, ColumnFormatOptions>} */
    const columnFormatting = {};
    const headers = order.map(key => {
        columnFormatting[key] = {
            columnWidth: labels[key].length,
            alignRight: !isNaN(parseInt(attracts[0][key], 10)),
        };
        return { 'key': key, 'label': labels[key] };
    });
    // Give the numeric column proper formatting.
    // TODO: toLocaleString - can it replace integerComma too?
    columnFormatting['ar'] = {
        alignRight: true,
        isFixedWidth: true,
        suffix: '%',
        columnWidth: 7,
    };
    let reply = `${mouse.value} (mouse) can be found the following ways:\n\`\`\``;
    reply += prettyPrintArrayAsString(attracts, columnFormatting, headers, '=');
    reply += '```\n' + `HTML version at: ${target_url}`;
    return reply;
}

/**
 * Determines if a string is a filter
 * @param {String} tester String to check if it's a filter
 * @returns {String} the filter as an object with code_name being the important attribute
 */
function getFilter(tester) {
    // Process filter-y nicknames
    if (!tester)
        return;
    tester = `${tester}`;
    if (tester.startsWith('3'))
        tester = '3_days';
    else if (tester.startsWith('all'))
        tester = 'alltime';
    else if (tester === 'current') {
        tester = '1_month';
        for (const filter of filters) {
            if (filter.start_time && !filter.end_time && filter.code_name !== tester) {
                tester = filter.code_name;
                break;
            }
        }
    }
    return getSearchedEntity(tester, filters)[0];
}

/**
 * Checks if the loot listed is one we know about. Returns the highest scoring match
 *
 * @param {string} tester The loot we're looking for
 * @param {Array} nicknames The nicknames for loot
 * @returns {Array<number>} The first loot that matched
 */
function getLoot(tester, nicknames) {
    if (!tester)
        return;
    tester = `${tester}`;
    if (nicknames && (tester in nicknames) && nicknames[tester])
        tester = nicknames[tester];
    return getSearchedEntity(tester, loot);
}

/**
 * Checks if the mouse requested is one we know about. Returns the highest scoring match
 *
 * @param {string} tester The mouse we're looking for
 * @param {Array} nicknames The nicknames for mice
 * @returns {Array<number>} The first mice that matched
 */
function getMice(tester, nicknames) {
    if (!tester)
        return;
    tester = `${tester}`;
    if (nicknames && (tester in nicknames) && nicknames[tester])
        tester = nicknames[tester];
    return getSearchedEntity(tester, mice);
}

/**
 * Finds a thing - uses MHCT searchByItem.php
 * @param {String} type Type of thing to find, supported by searchByItem.php
 * @param {int} id The MHCT numeric id of the thing to find
 * @param {Object} options Search options such as filter
 * @returns {Array} An array of things it found
 */
async function findThing(type, id, options) {
    if (!type || !id)
        return [];

    // If caching is ever implemented it'd be checked here
    const qsOptions = new URLSearchParams(options);
    qsOptions.append('item_type', type);
    qsOptions.append('item_id', id);
    const url = 'https://www.agiletravels.com/searchByItem.php?' + qsOptions.toString();
    return await fetch(url)
        .then(response => response.json())
        .catch(err => {
            Logger.log(`findThings: Error getting item ${qsOptions.toString()} - ${err}`);
        });
}

/**
 * Initialize (or refresh) a list of items from MHCT
 * @param {'mouse'|'loot'} type The type of thing to get a list of
 * @param {Array} list The list to populate / re-populate
 */
async function getMHCTList(type, list) {
    const now = DateTime.utc();
    if (type && refresh_list[type]) {
        const next_refresh = refresh_list[type].plus(refresh_rate);
        if (now < next_refresh)
            return [];
        refresh_list[type] = now;
    } else {
        Logger.log(`getMHCTList: Received a request for ${type} but I don't do that yet`);
    }
    Logger.log(`MHCT list: Getting a new ${type} list`);
    const url = `https://www.agiletravels.com/searchByItem.php?item_type=${type}&item_id=all`;
    await fetch(url)
        .then(response => (response.status === 200) ? response.json() : '')
        .then((body) => {
            if (body) {
                Logger.log(`MHCT: Got a new ${type} list`);
                list.splice(0, list.length);
                Array.prototype.push.apply(list, body);
                list.forEach(item => item.lowerValue = item.value.toLowerCase());
            }
        });
    Logger.log(`MHCT List: ${type} was ${list.length} long`);
}

/**
 * Initialize (or refresh) the known filters from @devjacksmith's tools.
 * @returns {Promise<void>}
 */
async function getFilterList() {
    const now = DateTime.utc();
    if (refresh_list.filter) {
        const next_refresh = refresh_list.filter.plus(refresh_rate);
        if (now < next_refresh)
            return Promise.resolve();
    }
    refresh_list.filter = now;

    Logger.log('Filters: Requesting a new filter list.');
    const url = 'https://www.agiletravels.com/filters.php';
    return fetch(url).then(response => (response.status === 200) ? response.json() : '').then((body) => {
        if (body) {
            Logger.log('Filters: Got a new filter list');
            filters.length = 0;
            Array.prototype.push.apply(filters, body);
            filters.forEach(filter => filter.lowerValue = filter.code_name.toLowerCase());
        } else {
            Logger.warn('Filters: request returned non-200 response');
        }
    }).catch(err => Logger.error('Filters: request returned error:', err));
}

/**
 * 
 * @param {Object} accumulator -- string or something with code_name as a property
 * @param {Object} current -- something with code_name as a property
 * @returns {String} Grows a string, meant to be with Array.reduce
 */
function code_name_reduce (accumulator, current) {
    if (accumulator.code_name) {
        accumulator = `\`${accumulator.code_name}\``;
    }
    if (current.code_name) {
        if (accumulator)
            return accumulator + `, \`${current.code_name}\``;
        else   
            return `\`${current.code_name}\``;
    } else {
        return accumulator;
    }
}

/**
 * Returns all known filters as a comma-separated list with back-ticks for "code" designation
 * @returns {String} Known filters, formatted for discord
 */
function listFilters() {
    return filters.reduce(code_name_reduce);
}

async function initialize() {
    if (someone_initialized)
        return true;
    someone_initialized = true;
    await Promise.all([
        getMHCTList('mouse', mice),
        getMHCTList('loot', loot),
        getFilterList(),
    ]);
    intervals.push(setInterval(() => { getMHCTList('mouse', mice); }, refresh_rate));
    intervals.push(setInterval(() => { getMHCTList('loot', loot); }, refresh_rate));
    intervals.push(setInterval(() => { getFilterList(); }, refresh_rate));
    Logger.log(`MHCT Initialized: Loot: ${loot.length}, mice: ${mice.length}, filters: ${filters.length}`);
    return true;
}

async function save() {
    intervals.forEach(i => clearInterval(i));
}

module.exports.getMHCTList = getMHCTList;
module.exports.initialize = initialize;
module.exports.findThing = findThing;
module.exports.getFilter = getFilter;
module.exports.getLoot = getLoot;
module.exports.getMice = getMice;
module.exports.formatLoot = formatLoot;
module.exports.formatMice = formatMice;
module.exports.sendInteractiveSearchResult = sendInteractiveSearchResult;
module.exports.getSearchedEntity = getSearchedEntity;
module.exports.listFilters = listFilters;
module.exports.save = save;
