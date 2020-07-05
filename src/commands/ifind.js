const Logger = require('../modules/logger');
const { initialize, getFilter, getLoot, formatLoot, sendInteractiveSearchResult } = require('../modules/mhct-lookup');
const CommandResult = require('../interfaces/command-result');

/**
 *
 * @param {Message} message The message that triggered the action
 * @param {Array} tokens The tokens of the command
 * @returns {Promise<CommandResult>} Status of the execution
 */
async function doIFIND(message, tokens) {
    const theResult = new CommandResult({ message, success: false, sentDM: false });
    let reply = '';
    const opts = {};
    const urlInfo = {
        qsParams: {},
        uri: 'https://mhhunthelper.agiletravels.com/loot.php',
        type: 'item',
    };
    if (!tokens)
        reply = 'I just cannot find what you\'re looking for (since you didn\'t tell me what it was).';
    else {
        //Set the filter if it's requested
        if (tokens[0] === '-e')
            tokens.shift();
        const filter = getFilter(tokens[0]);
        if (filter && 'code_name' in filter) {
            opts.timefilter = filter.code_name;
            tokens.shift();
        }
        // Figure out what they're searching for
        const searchString = tokens.join(' ');
        // TODO: When I put the reaction menu back it goes here
        const all_loot = getLoot(searchString, message.client.nicknames.get('loot'));
        if (all_loot && all_loot.length) {
            // We have multiple options, show the interactive menu
            urlInfo.qsParams = opts;
            sendInteractiveSearchResult(all_loot, message.channel, formatLoot,
                ['dm', 'group'].includes(message.channel.type), urlInfo, tokens);
            theResult.replied = true;
            theResult.success = true;
            theResult.sentDM = ['dm', 'group'].includes(message.channel.type);
        } else {
            reply = `I don't know anything about the loot "${searchString}", is it a mouse?`;
        }
    }
    if (reply) {
        try {
            // Note that a lot of this is handled by sendInteractiveSearchResult
            await message.channel.send(reply, { split: { prepend: '```\n', append: '\n```' } });
            theResult.replied = true;
            theResult.success = true;
            theResult.sentDM = ['dm', 'group'].includes(message.channel.type);
        } catch (err) {
            Logger.error('WHOIS: failed to send reply', err);
            theResult.botError = true;
        }
    }
    return theResult;

}

module.exports = {
    name: 'ifind',
    args: true,
    usage: 'Coming Soon',
    description: 'Find items sorted by their drop rates',
    canDM: true,
    execute: doIFIND,
    initialize: initialize,
};

// Testing area
//findThing('loot', 65, {})
//    .then(result => Logger.log(`Now is: ${JSON.stringify(result)}`));
