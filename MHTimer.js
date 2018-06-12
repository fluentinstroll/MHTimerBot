/*
  MHTimer Bot
*/
// Import required modules
const { DateTime, Duration, Interval } = require('luxon');
const Discord = require('discord.js');

// Import type-hinting definitions
const { Client, ClientUser, Guild, Message, RichEmbed, TextChannel, User } = require('discord.js');

const Timer = require('./timerClass.js');
// Access local URIs, like files.
const fs = require('fs');
// Access external URIs, like @devjacksmith 's tools.
const request = require('request');

// Globals
// var guild_id = '245584660757872640';
const client = new Discord.Client();
const main_settings_filename = 'settings.json',
    timer_settings_filename = 'timer_settings.json',
    hunter_ids_filename = 'hunters.json',
    reminder_filename = 'reminders.json',
    nickname_urls_filename = 'nicknames.json';

/** @type Timer[] */
const timers_list = [];
/** @type {TimerReminder[]} */
const reminders = [];
const file_encoding = 'utf8';
var settings = {};
const mice = [];
const items = [];
var hunters = {};
var nicknames = {};
var nickname_urls = {};
/** @type {Object <string, DateTime>} */
const last_timestamps = {
    reminder_save: null,
    hunter_save: null
}
/** @type {Object <string, NodeJS.Timer>} */
const dataTimers = {};
const refresh_rate = Duration.fromObject({ minutes: 5 });

//Only support announcing in 1 channel
var announce_channel;

//https://stackoverflow.com/questions/12008120/console-log-timestamps-in-chrome
console.logCopy = console.log.bind(console);

console.log = function()
{
    // Timestamp to prepend
    var timestamp = DateTime.utc().toJSON();

    if (arguments.length)
    {
        // True array copy so we can call .splice()
        var args = Array.prototype.slice.call(arguments, 0);

        // If there is a format string then... it must
        // be a string
        if (typeof arguments[0] === "string")
        {
            // Prepend timestamp to the (possibly format) string
            args[0] = "[" + timestamp + "] " + arguments[0];

            // Insert the timestamp where it has to be
            //args.splice(0, 0, "[" + timestamp + "]");

            // Log the whole array
            this.logCopy.apply(this, args);
        }
        else
        {
            // "Normal" log
            this.logCopy(timestamp, args);
        }
    }
};

process.on('uncaughtException', function (exception) {
  console.log(exception); // to see your exception details in the console
  // if you are on production, maybe you can send the exception details to your
  // email as well ?
});

function Main() {
    // Load global settings
    var a = new Promise(loadSettings);

    // Bot log in
    a.then(() => { client.login(settings.token); });

    // Create timers list from timers settings file
    a.then( createTimersList );

    // Load any saved reminders
    a.then( loadReminders );

    // Load any saved hunters
    a.then( loadHunters );

    // Bot start up tasks
    a.then(() => {
        client.on('ready', () => {
            console.log ('I am alive!');

            //for each guild find its #timers channel (if it has one)
            for (var [guildkey, guildvalue] of client.guilds) {
                let canAnnounce = false;
                for (var [chankey, chanvalue] of guildvalue.channels)
                    if (chanvalue.name === settings.timedAnnouncementChannel) {
                        createTimedAnnouncements(chanvalue);
                        canAnnounce = true;
                    }

                if (!canAnnounce)
                    console.log(`No channel for announcements in guild '${guildvalue.name}'.`);
            }
        });
    });

    // Message event router
    a.then(() => {
        client.on('message', message => {
            if (message.author.id === client.user.id) {
                return;
            }
            switch (message.channel.name){
                case settings.linkConversionChannel:
                    if(/^(http[s]?:\/\/htgb\.co\/).*/g.test(message.content.toLowerCase())){
                        convertRewardLink(message);
                    }
                    break;
                default:
                    if (message.channel.type === 'dm') {
                        parseUserMessage(message);
                    } else if (message.content.startsWith('-mh ')) {
                        parseUserMessage(message);
                    }
                    break;
            }
        });
        client.on('error', error => {
          console.log("Error Received");
          console.log(error);
          client.destroy();
          process.exit();
        });
        client.on('disconnect', event => {
          console.log("Close event: " + event.reason);
          console.log("Close code: " + event.code);
          client.destroy();
          process.exit();
        });
    });

    // Load nickname urls and only afterwards query the mouse & item lists.
    a.then( loadNicknameURLs )
        .then( getMouseList )
        .then( getItemList );

}
try {
  Main();
}
catch(error) {
  console.log(error);
}

/**
 * Load settings from the 'main_settings_filename'
 * 
 * @param {callback} resolve A callback for successful execution
 * @param {callback} reject A callback if an error occurred.
 */
function loadSettings(resolve, reject) {
    fs.readFile(main_settings_filename, file_encoding, (err, data) => {
        if (err) {
            console.log(err);
            reject();
            return;
        }
        settings = JSON.parse(data);
        if (!settings.linkConversionChannel)
            settings.linkConversionChannel = "larrys-freebies";
        if (!settings.timedAnnouncementChannel)
            settings.timedAnnouncementChannel = "timers";
        resolve();
    });
}

/**
 * Read individual timer settings from a file and create the associated timers.
 *
 * @param {callback} resolve A callback for successful execution.
 * @param {callback} reject A callback if an error occurred.
 */
function createTimersList(resolve, reject) {
    fs.readFile(timer_settings_filename, file_encoding, (err, data) => {
        if (err) {
            reject();
            return console.log(err);
        }

        let obj = JSON.parse(data);
        for (let i = 0; i < obj.length; i++ )
            timers_list.push(new Timer(obj[i]));
    });
}

/**
 * When the bot initializes, go through all known Timers and schedule their next announcement.
 * Also sets up the conversion from a single timeout-based call into a repeated-every-X interval.
 * 
 * @param {TextChannel} channel A channel interface on which announcements should be sent.
 */
function createTimedAnnouncements(channel) {
    console.log('Initializing announcements...');
    timers_list.forEach(timer => {
        let timeout = setTimeout(
            (timer, channel) => {
                // When activated, print the associated announcement.
                doAnnounce(timer, channel);
                timer.stopTimeout();
                // Schedule the announcement on a repeated interval.
                let interval = setInterval(
                    (timer, channel) => { doAnnounce(timer, channel); },
                    timer.getRepeatInterval().as('milliseconds'), timer, channel);
                timer.storeInterval(interval);
            },
            timer.getNext().diffNow().minus(timer.getAdvanceNotice()).as('milliseconds'),
            timer,
            channel);
        timer.storeTimeout(timeout);
    });
    console.log (`Let's say that ${timers_list.length} timeouts got created`);
}

/**
 * The meat of user interaction. Receives the message that starts with the magic
 * character and decides if it knows what to do next.
 *
 * @param {Message} message a Discord message to parse
 */
function parseUserMessage(message) {
    const tokens = splitString(message.content);
    if (!tokens.length) {
        message.channel.send("What is happening???");
        return;
    }

    // Messages that come in from public chat channels will be prefixed with '-mh'.
    if (tokens[0] === '-mh')
        tokens.shift();

    const command = tokens.shift();
    if (!command) {
        message.channel.send("I didn't understand, but you can ask me for help.");
        return;
    }

    // Parse the message to see if it matches any known timer areas, sub-areas, or has count information.
    const reminderRequest = tokens.length ? timerAliases(tokens) : {};

    switch (command.toLowerCase()) {
        // Display information about the next instance of a timer.
        case 'next':
            let aboutTimers = "Did you want to know about `sg`, `fg`, `reset`, `spill`, or `cove`?";
            if (!tokens.length) {
                // received "-mh next" -> display the help string.
                // TODO: pretty-print known timer info
                message.channel.send(aboutTimers);
            } else if (!reminderRequest.area) {
                // received "-mh next <words>", but the words didn't match any known timer information.
                // Currently, the only other information we handle is RONZA.
                switch (tokens[0].toLowerCase()) {
                    case 'ronza':
                        message.channel.send("Don't let aardwolf see you ask or you'll get muted");
                        // TODO: increment hunters[id] info? "X has delayed ronza by N years for asking M times"
                        break;
                    default:
                        message.channel.send(aboutTimers);
                }
            } else {
                // Display information about this known timer.
                let timerInfo = nextTimer(reminderRequest);
                if (typeof timerInfo === "string")
                    message.channel.send(timerInfo);
                else
                    message.channel.send("", { embed: timerInfo });
            }
            break;

        // Display or update the user's reminders.
        case 'remind':
            // TODO: redirect responses to PM.
            if (!tokens.length || !reminderRequest.area)
                listRemind(message);
            else
                addRemind(reminderRequest, message);
            break;

        // Display information about upcoming timers.
        case 'sched':
        case 'itin':
        case 'agenda':
        case 'itinerary':
        case 'schedule':
            // Default the searched time period to 24 hours if it was not specified.
            reminderRequest.count = reminderRequest.count || 24;

            let usage_str = buildSchedule(reminderRequest);
            // Discord limits messages to 2000 characters, so use multiple messages if necessary.
            while (usage_str.length > 2000) {
                let part_str = usage_str.substr(0, usage_str.lastIndexOf('\n', 2000));
                message.channel.send(part_str);
                usage_str = usage_str.substr(part_str.length);
            }
            message.channel.send(usage_str);
            break;

        // Display information about the desired mouse.
        case 'find':
        case 'mfind':
            if (!tokens.length)
                message.channel.send("You have to supply mice to find.");
            else {
                let criteria = tokens.join(" ").trim().toLowerCase().replace(/ mouse$/,'');
                if (criteria.length < 3)
                    message.channel.send("Your search string was too short, try again.");
                else
                    findMouse(message.channel, criteria, 'find');
            }
            break;

        // Display information about the desired item.
        case 'ifind':
            if (!tokens.length)
                message.channel.send("You have to supply an item to find");
            else {
                let criteria = tokens.join(" ").trim().toLowerCase();
                if (criteria.length < 3)
                    message.channel.send("Your search string was too short, try again.");
                else
                    findItem(message.channel, criteria, 'ifind');
            }
            break;

        // Update information about the user volunteered by the user.
        case 'iam':
            if (!tokens.length)
                message.channel.send("Yes, you are. Provide a hunter ID number to set that.");
            else if (tokens.length === 1 && !isNaN(tokens[0]))
                setHunterID(message, tokens[0]);
            else if (tokens.length === 1 && tokens[0].toLowerCase() === "not")
                unsetHunterID(message);
            else {
                // received -mh iam <words>. The user can specify where they are hunting, their rank/title, or their in-game id.
                // Nobody should need this many tokens to specify their input, but someone is gonna try for more.
                let userText = tokens.slice(1, 10).join(" ").trim().toLowerCase();
                if (tokens[0].toLowerCase() === "in") {
                    if (nicknames["locations"][userText])
                        userText = nicknames["locations"][userText];
                    setHunterProperty(message, "location", userText);
                }
                else if (["rank", "title", "a"].indexOf(tokens[0].toLowerCase()) !== -1) {
                    if (nicknames["ranks"][userText])
                        userText = nicknames["ranks"][userText];
                    setHunterProperty(message, "rank", userText);
                }
                else if (tokens[0].toLowerCase().substring(0, 3) === "snu" && tokens[1])
                    setHunterProperty(message, "snuid", userText);
                else
                    message.channel.send("I'm not sure what to do with that:\n  `-mh iam ###` to set a hunter ID.\n  `-mh iam rank <rank>` to set a rank.\n  `-mh iam in <location>` to set a location");
            }
            break;

        // Display volunteered information about known users. Handled inputs:
        /**
         * -mh whois ####                   -> hid lookup (No PM)
         * -mh whois snuid ####             -> snuid lookup (No PM)
         * -mh whois <word/@mention>        -> name lookup (No PM)
         * -mh whois in <words>             -> area lookup
         * -mh whois [rank|title|a] <words> -> random query lookup
         */
        case 'whois':
            if (!tokens.length) {
                message.channel.send("Who's who? Who's on first?");
                return;
            }

            let searchType = tokens.shift().toLowerCase();
            if (!isNaN(parseInt(searchType, 10))) {
                // hid lookup of 1 or more IDs.
                tokens.unshift(parseInt(searchType, 10));
                findHunter(message, tokens, "hid");
                return;
            }
            else if (searchType.substring(0, 3) === "snu") {
                // snuid lookup of 1 or more IDs.
                findHunter(message, tokens, "snuid");
                return;
            }
            else if (!tokens.length) {
                // Display name or user mention lookup.
                tokens.unshift(searchType);
                findHunter(message, tokens, "name");
                return;
            }
            else {
                // Rank or location lookup. tokens[] contains the terms to search
                let search = tokens.join(" ").toLowerCase();
                if (searchType === "in") {
                    if (nicknames["locations"][search]) {
                        search = nicknames["locations"][search];
                    }
                    searchType = "location";
                }
                else if (["rank", "title", "a"].indexOf(searchType) !== -1) {
                    if (nicknames["ranks"][search]) {
                        search = nicknames["ranks"][search];
                    }
                    searchType = "rank";
                }
                else {
                    message.channel.send("I'm not sure what to do with that:\n  `-mh whois [###|<mention>]` to look up specific hunters.\n  `-mh whois [in|a] [<location>|<rank>]` to find up to 5 random new friends.");
                    return;
                }
                const hunters = getHuntersByProperty(searchType, search);
                message.channel.send(hunters.length
                    ? `${hunters.length} random hunters: \`${hunters.join("\`, \`")}\``
                    : `I couldn't find any hunters with \`${searchType}\` matching \`${search}\``
                );
            }
            break;

        case 'help':
        case 'arrg':
        case 'aarg':
        default:
            let helpMessage = getHelpMessage(tokens);
            // TODO: Send help to PM?
            message.channel.send(helpMessage ? helpMessage : "Whoops! That's a bug.");
    }
}

/**
 * Convert a HitGrab shortlink into a BitLy shortlink that does not send the clicker to Facebook.
 * If successful, sends the converted link to the same channel that received the input message.
 * 
 * @param {Message} message a Discord message containing a htgb.co URL.
 */
function convertRewardLink(message){
    // Get the redirect url from htgb.co
    request({
        url: message.content.split(" ")[0],
        method: 'GET',
        followRedirect: false
    }, (error, response, body) => {
        if (!error && response.statusCode == 301) {
            const facebookURL = response.headers.location;
            const mousehuntURL = facebookURL.replace('https://apps.facebook.com/mousehunt', 'https://www.mousehuntgame.com');
            const queryProperties = { access_token: settings.bitly_token, longUrl: mousehuntURL };
            // Use Bitly to shorten the non-facebook reward link because people link pretty things
            request({
                url: 'https://api-ssl.bitly.com/v3/shorten',
                qs: queryProperties
            }, (error, response, body) => {
                if (!error && response.statusCode == 200) {
                    const responseJSON = JSON.parse(response.body);
                    console.log("MH reward link converted for non-facebook users");
                    message.channel.send(responseJSON.data.url + " <-- Non-Facebook Link");
                } else {
                    console.log("Bitly shortener failed for some reason" + error + response + body);
                }
            });
        } else {
            console.log("GET to htgb.co failed for some reason" + error + response + body);
        }
    });
}

/**
 * Simple utility function to tokenize a string, preserving double quotes.
 * Returns an array of the detected words from the input string.
 *
 * @param {string} input A string to split into tokens.
 * @returns {string[]} array
 */
function splitString(input) {
    const tokens = [];
    const splitRegexp = /[^\s"]+|"([^"]*)"/gi;

    let match = "";
    do {
        match = splitRegexp.exec(input);
        if (match) {
            // If we captured a group (i.e. a quoted phrase), push that, otherwise push the match (i.e. a single word).
            tokens.push(match[1] ? match[1] : match[0]);
        }
    } while (match);
    return tokens;
}

/**
 * @typedef {Object} ReminderRequest
 * @property {string} [area] The area of a Timer
 * @property {string} [sub_area] The sub-area of a Timer
 * @property {number} [count] The number of times a Timer should activate before this reminder is removed.
 */

/**
 * Attempt to find a Timer that satisfies the input tokens.
 * Returns a ReminderRequest of unknown state (may have some or all properties set).
 *
 * @param {string[]} tokens a set of tokens which may match known Timer areas or sub-areas.
 * @returns {ReminderRequest}
 */
function timerAliases(tokens) {
    const newReminder = {
        area: null,
        sub_area: null,
        count: null
    };
    const timerAreas = timers_list.map(timer => { return timer.getArea(); });
    const timerSubAreas = timers_list.map(timer => { return timer.getSubArea(); });
    // Scan the input tokens and attempt to match them to a known timer.
    for (let i = 0; i < tokens.length; i++) {
        let token = tokens[i].toLowerCase();

        // Check if this is an exact timer name, useful if we can dynamically add new timers.
        let areaIndex = timerAreas.indexOf(token);
        if (areaIndex !== -1) {
            newReminder.area = token;
            continue;
        } else {
            let subIndex = timerSubAreas.indexOf(token);
            if (subIndex !== -1) {
                newReminder.area = timerAreas[subIndex];
                newReminder.sub_area = token;
                continue;
            }
        }

        // Attempt to find an area from this token
        if (!newReminder.area && parseTokenForArea(token, newReminder))
            continue;

        // Attempt to find a sub-area from this token.
        if (!newReminder.sub_area && parseTokenForSubArea(token, newReminder))
            continue;

        // Attempt to find a count from this token.
        if (!newReminder.count && parseTokenForCount(token, newReminder))
            continue;

        // Upon reaching here, the token has no area, sub-area, or count information, or those fields
        // were already set, and thus it was not parsed for them.
        if (newReminder.area && newReminder.sub_area && newReminder.count !== null) {
            console.log(`Parsing user input to find timers, got an extra token '${String(token)}' from input '${tokens}'.`);
            break;
        }
    }

    return newReminder;
}

/**
 * Attempt to match the input string to known Timer areas. If successful, updates the given reminder.
 *
 * @param {string} token a word or phrase from a Discord message
 * @param {ReminderRequest} newReminder the reminder request being built from the entirety of the input Discord message
 * @returns {boolean} if the token parsed to an area.
 */
function parseTokenForArea(token, newReminder) {
    switch (token) {
        // Seasonal Garden aliases
        case 'sg':
        case 'seasonal':
        case 'season':
        case 'garden':
            newReminder.area = 'sg';
            break;

        // Forbidden Grove aliases
        case 'fg':
        case 'grove':
        case 'gate':
        case 'ar':
        case 'acolyte':
        case 'ripper':
        case 'realm':
            newReminder.area = 'fg';
            break;

        // Game Reset / Relic Hunter movement aliases
        case 'reset':
        case 'game':
        case 'rh':
        case 'midnight':
            newReminder.area = 'reset';
            break;

        // Balack's Cove aliases
        case 'cove':
        case 'balack':
        case 'tide':
            newReminder.area = 'cove';
            break;

        // Toxic Spill aliases
        case 'spill':
        case 'toxic':
        case 'ts':
            newReminder.area = 'spill';
            break;

        // This token is not a known timer area.
        default:
            return false;
    }
    return true;
}

/**
 * Attempt to match the input string to known Timer sub-areas. If successful, updates the given reminder.
 * Overwrites any previously-specified area.
 *
 * @param {string} token
 * @param {ReminderRequest} newReminder
 * @returns {boolean} if the token parsed to a sub-area.
 */
function parseTokenForSubArea(token, newReminder) {
    switch (token) {
        // Seasonal Garden seasons aliases.
        case 'fall':
        case 'autumn':
            newReminder.area = 'sg';
            newReminder.sub_area = 'autumn';
            break;
        case 'spring':
            newReminder.area = 'sg';
            newReminder.sub_area = 'spring';
            break;
        case 'summer':
            newReminder.area = 'sg';
            newReminder.sub_area = 'summer';
            break;
        case 'winter':
            newReminder.area = 'sg';
            newReminder.sub_area = 'winter';
            break;

        // Forbidden Grove gate state aliases.
        case 'open':
        case "opens":
        case 'opened':
        case 'opening':
            newReminder.area = 'fg';
            newReminder.sub_area = 'open';
            break;
        case 'close':
        case 'closed':
        case 'closing':
        case 'shut':
            newReminder.area = 'fg';
            newReminder.sub_area = 'close';
            break;

        // Balack's Cove tide aliases.
        case 'low-tide':
        case 'lowtide':
        case 'low':
            newReminder.area = 'cove';
            newReminder.sub_area = 'low';
            break;
        case 'mid-tide':
        case 'midtide':
        case 'mid':
            newReminder.area = 'cove';
            newReminder.sub_area = 'mid';
            break;
        case 'high-tide':
        case 'hightide':
        case 'high':
            newReminder.area = 'cove';
            newReminder.sub_area = 'high';
            break;

        // Toxic Spill severity level aliases.
        case 'archduke':
        case 'ad':
        case 'archduchess':
        case 'aardwolf':
        case 'arch':
            newReminder.area = 'spill';
            newReminder.sub_area = 'arch';
            break;
        case 'grandduke':
        case 'gd':
        case 'grandduchess':
        case 'grand':
            newReminder.area = 'spill';
            newReminder.sub_area = 'grand';
            break;
        case 'duchess':
        case 'duke':
            newReminder.area = 'spill';
            newReminder.sub_area = 'duke';
            break;
        case 'countess':
        case 'count':
            newReminder.area = 'spill';
            newReminder.sub_area = 'count';
            break;
        case 'baronness':
        case 'baron':
            newReminder.area = 'spill';
            newReminder.sub_area = 'baron';
            break;
        case 'lady':
        case 'lord':
            newReminder.area = 'spill';
            newReminder.sub_area = 'lord';
            break;
        case 'heroine':
        case 'hero':
            newReminder.area = 'spill';
            newReminder.sub_area = 'hero';
            break;

        // This token did not match any known Timer sub-areas.
        default:
            return false;
    }
    return true;
}

/**
 * Attempt to match the input string to a positive integer. If successful, updates the given reminder.
 * Overwrites any previously-specified count.
 *
 * @param {string} token
 * @param {ReminderRequest} newReminder
 * @returns {boolean} if the token parsed to a integer
 */
function parseTokenForCount(token, newReminder) {
    switch (token) {
        // Words for numbers...
        case 'once':
        case 'one':
            newReminder.count = 1;
            break;

        case 'twice':
        case 'two':
            newReminder.count = 2;
            break;

        case 'thrice':
        case 'three':
            newReminder.count = 3;

        case 'always':
        case 'forever':
        case 'unlimited':
        case 'inf':
        case 'infinity':
            newReminder.count = -1;
            break;

        case 'never':
        case 'end':
        case 'forget':
        case 'quit':
        case 'stop':
            newReminder.count = 0;
            break;

        // If it is an actual number, then we can just use it as normal. Note that parseInt will
        // take garbage input like unrepresentably large numbers and coerce to + /-Infinity.
        default:
            if (!isNaN(parseInt(token, 10))) {
                let val = parseInt(token, 10);
                if (val == Infinity || val < 0)
                    val = -1;
                newReminder.count = val;
                break;
            }
            return false;
    }
    return true;
}

/**
 * Returns the next occurrence of the class of timers as a RichEmbed, or a string if no
 * Timer matched the input TimerRequest.
 * TODO - this should take an array as an argument and process the words passed in
 * @param {ReminderRequest} timerName
 * @returns {RichEmbed|string}
 */
function nextTimer(timerName) {
    // Inspect all known timers to determine the one that matches the requested area, and occurs soonest.
    const area = timerName.area,
        sub = timerName.sub_area,
        areaTimers = timers_list.filter(timer => { return timer.getArea() === area; });

    let nextTimer;
    for (let timer of areaTimers)
        if (!sub || sub === timer.getSubArea())
            if (!nextTimer || timer.getNext() < nextTimer.getNext())
                nextTimer = timer;

    if (!nextTimer) {
        // Prepare a detailed list of known timers and their sub-areas.
        let details = {};
        timers_list.forEach(timer => {
            let area = `\`${timer.getArea()}\``;
            if (!details[area])
                details[area] = [];
            if (timer.getSubArea())
                details[area].push(timer.getSubArea());
        });
        let names = [];
        for (let area in details) {
            let description = area;
            if (details[area].length)
                description += ` (${details[area].join(", ")})`;
            names.push(description);
        }

        return `I do not know that timer, but I do know:\n${names.join("\n")}`;
    }

    const sched_syntax = "-mh remind " + area + (sub ? " " + sub : "");
    return (new Discord.RichEmbed()
        .setDescription(nextTimer.getDemand()
            + "\n" + timeLeft(nextTimer.getNext())
            // Putting here makes it look nicer and fit in portrait mode
            + "\nTo schedule this reminder: `" + sched_syntax + "`"
        )
        .setTimestamp(nextTimer.getNext().toJSDate())
        .setFooter("at") // There has to be something in here or there is no footer
    );
}

/**
 * Returns a string ending that specifies the (human-comprehensible) amount of
 * time remaining before the given input.
 * Ex "in 35 days, 14 hours, and 1 minute" 
 *
 * @param {DateTime} in_date The impending time that humans must be warned about.
 * @returns {string} A timestring that indicates the amount of time left before the given Date.
 */
function timeLeft(in_date) {
    const units = ["days", "hours", "minutes"];
    const remaining = in_date.diffNow(units);
    
    // Make a nice string, but only if there are more than 60 seconds remaining.
    if (remaining.as("milliseconds") < 60 * 1000)
        return "in less than a minute";

    // We could use 'Duration#toFormat', but then we will always get days,
    // hours, and minutes, even if the duration is very short.
    // return remaining.toFormat("'in' dd 'days,' HH 'hours, and ' mm 'minutes");
    // return remaining.toFormat("'in' dd':'HH':'mm");

    // Push any nonzero units into an array, removing "s" if appropriate (since unit is plural).
    const labels = [];
    units.forEach(unit => {
        let val = remaining.get(unit);
        if (val)
            labels.push(`${val.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${(val !== 1) ? unit : unit.slice(0, -1)}`);
    });
    // `labels` should not be empty at this point.

    // Join the labels together with commas. We use extra logic for the 'and'
    // return labels.join(", ");
    let retStr = "in ", line = 0, numLines = labels.length;
    for (; line < numLines - 2; ++line)
        retStr += labels[line] + ", ";
    if (numLines > 1)
        retStr += labels[line] + (numLines > 2 ? ", and " : " and ") + labels[line + 1];
    else
        retStr += labels[line];

    return retStr;
}


/**
 * @typedef {Object} TimerReminder
 * @property {ClientUser} user The Discord user who requested the reminder.
 * @property {number} count The number of remaining times this reminder will activate.
 * @property {string} area The area to which this reminder applies, e.g. "fg"
 * @property {string} [sub_area] A logical "location" within the area, e.g. "close" or "open" for Forbidden Grove.
 * @property {number} [fail] The number of times this particular reminder encountered an error (during send, etc.)
 */

/**
 * Read the reminders JSON file, and populate the array for use
 */
function loadReminders() {
    console.log(`Scheduling save for reminders every ~${refresh_rate.as('minutes')} minutes.`);
    // Do we need to do anything if saveReminders calls its reject()?
    dataTimers['reminders'] = setInterval(saveReminders,
        refresh_rate.as('milliseconds') * (Math.random() + 1));

    console.log("loading reminders");
    fs.readFile(reminder_filename, file_encoding, (err, data) => {
        if (err) {
            // ENOENT -> File did not exist in the given location.
            if (err.code !== "ENOENT")
                console.log(err);
            return;
        }

        Array.prototype.push.apply(reminders, JSON.parse(data));
        console.log (reminders.length + " reminders loaded");
    });
}

/**
 * Serialize the reminders array to the reminders JSON file, to guard against data loss
 * from crashes, disconnects, reboots, etc.
 */
function saveReminders() {
    // Remove any expired timers - no need to save them.
    if (reminders.length) {
        // Move expired reminders to the end.
        reminders.sort((a, b) => { return a.count === 0 ? 1 : (b.count - a.count); });

        // Find the first non-expired one.
        let i = reminders.length,
            numExpired = 0;
        while (i--) {
            if (reminders[i].count === 0)
                ++numExpired;
            else
                break;
        }
        if (numExpired === reminders.length)
            reminders.length = 0;
        else if (numExpired) {
            // Advance to the next record (which should be expired and a valid index).
            ++i;
            // If the current reminder is expired, splice it and the others away.
            if (i < reminders.length && reminders[i].count === 0) {
                let discarded = reminders.splice(i, numExpired);
                console.log(`Spliced ${discarded.length} expired records. ${reminders.length} remaining.`);
            }
        }
    }
    fs.writeFile(reminder_filename, JSON.stringify(reminders, null, 1), file_encoding, err => {
        if (err) {
            reject();
            return console.log(err);
        }
        last_timestamps.reminder_save = DateTime.utc();
        console.log(`Reminders saved successfully at ${last_timestamps.reminder_save}.`);
    });
}

/**
 * Send the given timer's announcement to the given channel, and then process
 * any reminders that chatters may have set up.
 *
 * @param {Timer} timer The timer being announced.
 * @param {TextChannel} channel The Discord channel that will receive the message.
 */
function doAnnounce(timer, channel) {
    channel.send(timer.getAnnouncement())
      .catch(error => {
          console.log(error);
          console.log(channel.client.status)
      });

    doRemind(timer);
}

/**
 * Locate any known reminders that reference this timer, and send a PM to
 * the chatter who requested it.
 *
 * @param {Timer} timer The activated timer.
 */
function doRemind(timer) {
    // Cache these values.
    const area = timer.getArea(),
        sub = timer.getSubArea();

    reminders.filter(reminder => { return area === reminder.area && reminder.count !== 0 })
        .forEach(reminder => {
            // If there no sub-area for this timer, or the one specified matches
            // that of the reminder, activate the reminder.
            if (!sub || sub === reminder.sub_area)
                client.fetchUser(reminder.user)
                    .then(user => { sendRemind(user, reminder, timer); })
                    .catch(err => {
                        reminder.fail = (reminder.fail || 0) + 1;
                        console.log(err);
                    });
        });

    // Serialize the current reminders and their updated remaining counts.
    saveReminders();
}

/**
 * Takes a user object and a reminder "object" and sends the reminder text via PM.
 *
 * @param {ClientUser} user
 * @param {TimerReminder} remind
 * @param {Timer} timer
 */
function sendRemind(user, remind, timer) {
    // Don't remind invalid users, or chat with bots.
    if (!user || user.bot) {
        remind.fail = (remind.fail || 0) + 1;
        return -1;
    }

    // For non-perpetual reminders, decrement the counter.
    if (remind.count > 0)
        --remind.count;

    // Describe the remaining reminders.
    let count_str = "You have ";
    if (remind.count < 0) {
        count_str += "unlimited";
    } else if (remind.count == 0) {
        count_str += "no more";
    } else {
        count_str += remind.count;
    }
    count_str += " reminders left for this timer.";

    // How to add or remove additional counts.
    let alter_str = "Use `-mh remind " + remind.area;
    if (typeof remind.sub_area !== 'undefined') {
        alter_str += " " + remind.sub_area;
    }
    if (remind.count == 0) {
        alter_str += "` to turn this reminder back on.";
    } else {
        alter_str += " stop` to end them sooner.";
    }
    alter_str += " See also `-mh help remind` for other options.";

    if (remind.fail) {
        usage_str += " There were " + remind.fail + " failures before this got through.\n";
        if (remind.fail > 10) {
            console.log("I am removing a reminder for " + remind.user + " due to too many failures\n");
            remind.count = 0;
        }
    }
    // console.log("Processed reminder", remind);
    user.send(timer.getAnnouncement() + "\n" + usage_str )
        .then(() => { remind.fail = 0; }, //worked
            () => { remind.fail = (remind.fail || 0) + 1; });
}

/**
 * Add (or remove) a reminder.
 * 
 * @param {ReminderRequest} timerRequest a timer request which has already passed through token
 *                                       validation to set 'area' and 'sub_area' as possible.
 * @param {Message} message the Discord message that initiated this request.
 */
function addRemind(timerRequest, message) {
    // If there were no area, the reminders would have been
    // listed instead of 'addRemind' being called.
    const area = timerRequest.area;
    const subArea = timerRequest.sub_area;
    if (!area) {
        message.channel.send("I do not know the area you asked for");
        return;
    }

    // Default to reminding the user once.
    const count = timerRequest.count || (timerRequest.count === 0 ? 0 : 1);
    const name = `${area}${subArea ? `: ${subArea}` : ""}`;

    // Delete the reminder, if that is being requested.
    // (Rather than try to modify the positions and number of elements in
    // reminders e.g. thread race saveReminders, simply set the count to 0.)
    if (!count) {
        let responses = [];
        for (let reminder of reminders)
            if (reminder.user === message.author.id && reminder.area === area) {
                if (subArea && subArea === reminder.sub_area) {
                    reminder.count = 0;
                    responses.push(`Reminder for '${name}' turned off.`);
                }
                else if (!subArea && !reminder.sub_area) {
                    reminder.count = 0;
                    responses.push(`Reminder for '${name}' turned off.`);
                }
            }

        message.author.send(responses.length
            ? `\`\`\`${responses.join("\n")}\`\`\``
            : `I couldn't find a reminder for you in '${name}'.`
        );
        return;
    }

    // User asked to be reminded - find a timer that meets the request.
    const choices = timers_list.filter(choice => {
        return (area === choice.getArea() && (!subArea || subArea === choice.getSubArea()));
    }).sort((a, b) => (a.getNext() - b.getNext()));
    console.log(`Found ${choices.length} matching timer request:`, timerRequest, choices);

    // Assume the desired timer is the soonest one that matched the given criteria.
    let timer = choices.pop();
    if (!timer) {
        // TODO: dynamic area response.
        message.author.send("I'm sorry, there weren't any timers I know of that match your request.");
        return;
    }

    const newReminder = {
        "count": count,
        "area": area,
        "user": message.author.id
    };
    if (timer.getSubArea())
        newReminder.sub_area = subArea;

    // If the reminder already exists, set its new count to the requested count.
    let responses = [];
    for (let reminder of reminders)
        if (reminder.user === message.author.id && reminder.area === area) {
            if (subArea && reminder.sub_area === subArea) {
                responses.push(`Updated reminder count for '${name}' from ${reminder.count} to ${count}.`);
                reminder.count = count;
            }
            else if (!subArea && !reminder.sub_area) {
                responses.push(`Updated reminder count for '${name}' from ${reminder.count} to ${count}.`);
                reminder.count = count;
            }
        }

    if (responses.length) {
        console.log(`Updated ${responses.length} reminders for ${message.author.username} to a count of ${count}.`, timerRequest);
        message.author.send(`\`\`\`${responses.join("\n")}\`\`\``);
        return;
    }

    // No updates were made - free to add a new reminder.
    reminders.push(newReminder);
    responses.push(`Reminder for ${name} set to PM you`);
    responses.push((count === 1) ? "once" : (count < 0) ? "until you stop it" : `${count} times.`);

    // Inform the user of the new reminder, in PM only.
    if (message.channel.type !== "dm")
        responses.unshift(`Hi there! Reminders are only sent via PM, and I'm just making sure I can PM you.`);

    // Send notice of the update via PM.
    message.author.send(responses.join(" ")).then(
        () => console.log(`Added ${newReminder} for ${message.author.id} successfully.`),
        () => console.log(`Reminder notification failure for ${message.author.id}. Still created and activated reminder ${newReminder}.`)
    );
}

/**
 * List the reminders for the user, and PM them the result.
 * 
 * @param {Message} message a Discord message containing the request to list reminders.
 */
function listRemind(message) {
    const user = message.author.id,
        pm_channel = message.author;
    let timer_str = "Your reminders:";
    let usage_str;

    const userReminders = reminders.filter(reminder => (reminder.user === user));
    userReminders.forEach(reminder => {
        // TODO: prettyPrint this info.
        timer_str += `\nTimer:\t\`${reminder.area}\``;
        usage_str = `\`-mh remind ${reminder.area}`;
        if (reminder.sub_area) {
            timer_str += ` (${reminder.sub_area})`;
            usage_str += ` ${reminder.sub_area}`;
        }

        if (reminder.count === 1)
            timer_str += " one more time";
        else if (reminder.count === -1)
            timer_str += " until you stop it";
        else
            timer_str += ` ${reminder.count} times`;

        timer_str += `.\n\t${usage_str} stop\` to turn off\n`;

        if (reminder.fail)
            timer_str += `There have been ${reminder.fail} failed attempts to activate this reminder.\n`;
    });

    pm_channel.send(userReminders.length ? timer_str : "I found no reminders for you, sorry.")
        .catch(() => console.log(`PM Notification failure for ${pm_channel.username}. Possibly blocked.`));
}

/**
 * Compute which timers are coming up in the next bit of time, for the requested area.
 * Returns a ready-to-print string listing up to 24 of the found timers, with their "demand" and when they will activate.
 * TODO: should this return a RichEmbed?
 * 
 * @param {{area: string, count: number}} timer_request A request that indicates the number of hours to search ahead, and the area in which to search
 * @returns {string} a ready-to-print string containing the timer's demand, and how soon it will occur.
 */
function buildSchedule(timer_request) {
    const area = timer_request.area;

    // Search from 1 hour to 10 days out.
    let req_hours = Duration.fromObject({ hours: timer_request.count });
    if (!req_hours.isValid) {
        return "Invalid timespan given - how many hours did you want to look ahead?";
    }
    else if (req_hours.as('hours') <= 0)
        req_hours = req_hours.set({ hours: 24 });
    else if (req_hours.as('days') >= 10)
        req_hours = req_hours.shiftTo('days').set({ days: 10 });

    // Get the next occurrence for every timer. Compare its interval to determine how many of them to include
    const until = DateTime.utc().plus(req_hours);
    /** @type {{time: DateTime, message: string}[]} */
    const upcoming_timers = [];
    const max_timers = 24;
    (!area ? timers_list : timers_list.filter(timer => (timer.getArea() === area)))
        .forEach(timer => {
            let message = timer.getDemand();
            for (let time of timer.upcoming(until))
                upcoming_timers.push({ time: time, message: message });
        });

    // Sort the list of upcoming timers in this area by time, so that the soonest is printed first.
    upcoming_timers.sort((a, b) => { return a.time - b.time; });

    // Make a nice message to display.
    let return_str = `I have ${upcoming_timers.length} timers coming up in the next ${req_hours.as('hours')} hours`;
    if (upcoming_timers.length > max_timers) {
        return_str += `. Here are the next ${max_timers} of them`;
        upcoming_timers.splice(max_timers, upcoming_timers.length)
    }
    return_str += upcoming_timers.length ? ":\n" : ".";

    return_str = upcoming_timers.reduce((str, val) => {
        return `${str}${val.message} ${timeLeft(val.time)}\n`;
    }, return_str);

    return return_str;
}

/**
 * Get the help text.
 * TODO: Should this be a RichEmbed?
 * TODO: Dynamically generate this information based on timers, etc.
 *
 * @param {string[]} [tokens] An array of user text, the first of which is the specific command to get help for.
 * @returns {string} The desired help text.
 */
function getHelpMessage(tokens) {
    // TODO: dynamic help text - iterate known keyword commands and their arguments.
    const keywords = "`iam`, `whois`, `remind`, `next`, `find`, `ifind`, and`schedule`";
    if (!tokens || !tokens.length) {
        return [
            `I know the keywords ${keywords}.`,
            "You can use `-mh help <keyword>` to get specific information about how to use it.",
            "Example: `-mh help next` provides help about the 'next' keyword, `-mh help remind` provides help about the 'remind' keyword.",
            "Pro Tip: **All commands work in PM!**"
        ].join("\n");
    }

    const areaInfo = "Areas are Seasonal Garden (**sg**), Forbidden Grove (**fg**), Toxic Spill (**ts**), Balack's Cove (**cove**), and the daily **reset**.";
    const subAreaInfo = "Sub areas are the seasons, open/close, spill ranks, and tide levels";
    const privacyWarning = "Setting your location and rank means that when people search for those things, you can be randomly added to the results.";

    if (tokens[0] === 'next') {
        return [
            "Usage: `-mh next [<area> | <sub-area>]` will provide a message about the next related occurrence.",
            areaInfo,
            subAreaInfo,
            "Example: `-mh next fall` will tell when it is Autumn in the Seasonal Garden."
        ].join("\n");
    }
    else if (tokens[0] === 'remind') {
        return [
            "Usage: `-mh remind [<area> | <sub-area>] [<number> | always | stop]` will control my reminder function relating to you specifically.",
            "Using the word `stop` will turn off a reminder if it exists.",
            "Using a number means I will remind you that many times for that timer.",
            "Use the word `always` to have me remind you for every occurrence.",
            "Just using `-mh remind` will list all your existing reminders and how to turn off each",
            areaInfo,
            subAreaInfo,
            "Example: `-mh remind close always` will always PM you 15 minutes before the Forbidden Grove closes."
        ].join("\n");
    }
    else if (tokens[0].substring(0, 5) === 'sched') {
        return [
            "Usage: `-mh schedule [<area>] [<number>]` will tell you the timers scheduled for the next `<number>` of hours. Default is 24, max is 240.",
            "If you provide an area, I will only report on that area.",
            areaInfo
        ].join("\n");
    }
    else if (tokens[0] === 'find') {
        return [
            "Usage `-mh find <mouse>` will print the top attractions for the mouse, capped at 10.",
            "All attraction data is from <https://mhhunthelper.agiletravels.com/>.",
            "Help populate the database for better information!"
        ].join("\n");
    }
    else if (tokens[0] === 'ifind') {
        return [
            "Usage `-mh ifind <item>` will print the top drop rates for the item, capped at 10.",
            "All drop rate data is from <https://mhhunthelper.agiletravels.com/>.",
            "Help populate the database for better information!"
        ].join("\n");
    }
    else if (tokens[0] === 'iam') {
        return [
            "Usage `-mh iam <####>` will set your hunter ID. **This must be done before the other options will work.**",
            "  `-mh iam in <location>` will set your hunting location. Nicknames are allowed.",
            "  `-mh iam rank <rank>` will set your rank. Nicknames are allowed.",
            "  `-mh iam not` will remove you from results.",
            privacyWarning
        ].join("\n");
    }
    else if (tokens[0] === 'whois') {
        return [
            "Usage `-mh whois <####>` will try to look up a Discord user by MH ID. Only works if they set their ID.",
            "  `-mh whois <user>` will try to look up a hunter ID based on a user in the server.",
            "  `-mh whois in <location>` will find up to 5 random hunters in that location.",
            "  `-mh whois rank <rank>` will find up to 5 random hunters with that rank.",
            privacyWarning
        ].join("\n");
    }
    else
        return `I don't know that one but I do know ${keywords}.`;
}

/**
 * Initialize (or refresh) the known mice lists from @devjacksmith's tools.
 * Updates the mouse nicknames as well.
 */
function getMouseList() {
    console.log("Checking mouse dates");
    const now = DateTime.utc();
    // Only request a mouse list update every so often.
    if ("mouse_refresh" in last_timestamps) {
        let next_refresh = last_timestamps.mouse_refresh.plus(refresh_rate);
        if (now < next_refresh)
            return;
    }
    last_timestamps.mouse_refresh = now;

    // Query @devjacksmith's tools for mouse lists.
    const url = "https://mhhunthelper.agiletravels.com/searchByItem.php?item_type=mouse&item_id=all";
    request({
        url: url,
        json: true
    }, (error, response, body) => {
        if (!error && response.statusCode == 200) {
            console.log("Got a mouse list");
            mice.length = 0;
            Array.prototype.push.apply(mice, body);
            for (let i = 0, len = mice.length; i < len; ++i)
                mice[i].lowerValue = mice[i].value.toLowerCase();
        }

        // Populate the nickname values for mice.
        getNicknames("mice");
    });
}

/**
 * Query @devjacksmith's database for information about the desired mouse.
 *
 * @param {TextChannel} channel the channel on which to respond.
 * @param {string} args a lowercased string of search criteria.
 * @param {string} command the command switch used to arrive in this function. For a mouse lookup, this will be 'find'. If searching for a mouse with items, will be 'ifind'.
 */
function findMouse(channel, args, command) {
    //NOTE: RH location is https://mhhunthelper.agiletravels.com/tracker.json
    let url = 'https://mhhunthelper.agiletravels.com/searchByItem.php?item_type=mouse';
    let retStr = `'${args}' not found`;

    // Deep copy the input args, in case we modify them.
    const orig_args = JSON.parse(JSON.stringify(args));

    // Process args for flags, like the -e event filter.
    let tokens = args.split(/\s+/);
    if (tokens.length > 2) {
        if (tokens[0] === "-e") {
            url += `&timefilter=${tokens[1]}`;
            tokens.splice(0, 2);
        }
        args = tokens.join(" ");
    }
    // If the input was a nickname, convert it to the queryable value.
    if (nicknames["mice"][args])
        args = nicknames["mice"][args];


    const MATCH_LENGTH = args.length;
    for (let i = 0, len = mice.length; i < len; ++i)
        if (mice[i].lowerValue.substring(0, MATCH_LENGTH) === args) {
            let mouseID = mice[i].id;
            let mouseName = mice[i].value;
            url += `&item_id=${mouseID}`;
            request({
                url: url,
                json: true
            }, (error, response, body) => {
                const attractions = [];
                if (!error && response.statusCode === 200 && Array.isArray(body)) {
                    // body is an array of objects with: location, stage, total_hunts, rate, cheese
                    // Sort it by "rate" but only if hunts > 100
                    body.filter(setup => (setup.total_hunts > 99)).forEach(setup => {
                        attractions.push(
                            {
                                location: setup.location,
                                stage: setup.stage ? setup.stage : " N/A ",
                                total_hunts: integerComma(setup.total_hunts),
                                rate: setup.rate * 1.0 / 100,
                                cheese: setup.cheese
                            });
                    });
                } else {
                    console.log("Lookup failed for some reason:", error, response, body);
                    channel.send(`Could not process results for '${args}', AKA ${mouseName}`);
                    return;
                }

                // If there was a result, create a nice-looking table from the data.
                let retStr = "";
                if (attractions.length) {
                    // Sort that by Attraction Rate, descending.
                    attractions.sort((a, b) => { return b.rate - a.rate; });
                    // Keep only the top 10 results.
                    attractions.splice(10);

                    // Column Formatting specification.
                    /** @type {Object <string, ColumnFormatOptions>} */
                    const columnFormatting = {};

                    // Specify the column order.
                    const order = ["location", "stage", "cheese", "rate", "total_hunts"];
                    // Inspect the attractions array to determine if we need to include the stage column.
                    if (attractions.every(row => (row.stage === " N/A ")))
                        order.splice(order.indexOf("stage"), 1);

                    // Build the header row.
                    const labels = { location: "Location", stage: "Stage", total_hunts: "Hunts", rate: "AR", cheese: "Cheese" }
                    const headers = order.map(key => {
                        columnFormatting[key] = {
                            columnWidth: labels[key].length,
                            alignRight: !isNaN(parseInt(attractions[0][key]))
                        };
                        return { 'key': key, 'label': labels[key] };
                    })

                    // Give the numeric column proper formatting.
                    columnFormatting['rate'] = {
                        alignRight: true,
                        isFixedWidth: true,
                        columnWidth: 7,
                        suffix: "%"
                    };

                    let table = prettyPrintArrayAsString(attractions, columnFormatting, headers, "=");
                    retStr = `${mouseName} (mouse) can be found the following ways:\n\`\`\`\n${table}\n\`\`\`\n`;
                    retStr += `HTML version at: <https://mhhunthelper.agiletravels.com/?mouse=${mouseID}>`;
                }
                else
                    retStr = `${mouseName} either hasn't been seen enough, or something broke.`;
                channel.send(retStr);
            });
            return;
        }


    // No matching mouse was found. If this was a mouse search, find try finding an item.
    if (command === 'find')
        findItem(channel, orig_args, command);
    else {
        channel.send(retStr);
        getItemList();
    }
}

/**
 * Initialize (or refresh) the known loot lists from @devjacksmith's tools.
 * Updates the loot nicknames as well.
 */
function getItemList() {
    console.log("Checking item dates");
    const now = DateTime.utc();
    if ("item_refresh" in last_timestamps) {
        let next_refresh = last_timestamps.item_refresh.plus(refresh_rate);
        if (now < next_refresh)
            return;
    }
    last_timestamps.item_refresh = now;

    const url = "https://mhhunthelper.agiletravels.com/searchByItem.php?item_type=loot&item_id=all";
    request({
        url: url,
        json: true
    }, (error, response, body) => {
        if (!error && response.statusCode == 200) {
            console.log("Got a loot list");
            items.length = 0;
            Array.prototype.push.apply(items, body);
            for (let i = 0, len = items.length; i < len; ++i)
                items[i].lowerValue = items[i].value.toLowerCase();
        }

        // Populate the nickname values for loot.
        getNicknames("loot");
    });
}

function findItem(channel, args, command) {
    //NOTE: RH location is https://mhhunthelper.agiletravels.com/tracker.json
    let url = 'https://mhhunthelper.agiletravels.com/searchByItem.php?item_type=loot';
    let retStr = `'${args}' not found`;

    // Deep copy the input args, in case we modify them.
    const orig_args = JSON.parse(JSON.stringify(args));

    // Process args for flags, like the -e event filter.
    let tokens = args.split(/\s+/);
    if (tokens.length > 2) {
        if (tokens[0] === "-e") {
            url += `&timefilter=${tokens[1]}`;
            tokens.splice(0, 2);
        }
        args = tokens.join(" ");
    }
    // If the input was a nickname, convert it to the queryable value.
    if (nicknames["loot"][args])
        args = nicknames["loot"][args];

    const MATCH_LENGTH = args.length;
    for (let i = 0, len = items.length; i < len; ++i)
        if (items[i].lowerValue.substring(0, MATCH_LENGTH) === args) {
            let itemID = items[i].id;
            let itemName = items[i].value;
            url += `&item_id=${itemID}`;
            request({
                url: url,
                json: true
            }, (error, response, body) => {
                const attractions = [];
                if (!error && response.statusCode == 200 && Array.isArray(body)) {
                    // body is an array of objects with: location, stage, total_hunts, rate, cheese
                    // Sort by "rate" but only if hunts >= 100
                    body.filter(setup => (setup.total_hunts > 99)).forEach(setup => {
                        attractions.push(
                            {
                                location: setup.location,
                                stage: setup.stage === null ? " N/A " : setup.stage,
                                total_hunts: integerComma(setup.total_hunts),
                                rate: setup.rate * 1.0 / 1000, // Divide by 1000? should this be 100?
                                cheese: setup.cheese
                            });
                    });
                } else {
                    console.log("Lookup failed for some reason", error, response, body);
                    channel.send(`Could not process results for '${args}', AKA ${itemName}`);
                    return;
                }
                let retStr = "";
                if (attractions.length) {
                    // Sort the setups by the drop rate.
                    attractions.sort((a, b) => { return b.rate - a.rate; });
                    // And keep only the top 10 results.
                    attractions.splice(10);

                    // Column Formatting specification.
                    /** @type {Object <string, ColumnFormatOptions>} */
                    const columnFormatting = {};

                    // Specify the column order.
                    const order = ["location", "stage", "cheese", "rate", "total_hunts"];
                    // Inspect the setups array to determine if we need to include the stage column.
                    if (attractions.every(row => (row.stage === " N/A ")))
                        order.splice(order.indexOf("stage"), 1);

                    // Build the header row.
                    const labels = { location: "Location", stage: "Stage", total_hunts: "Hunts", rate: "DR", cheese: "Cheese" }
                    const headers = order.map(key => {
                        columnFormatting[key] = {
                            columnWidth: labels[key].length,
                            alignRight: !isNaN(parseInt(attractions[0][key]))
                        };
                        return { 'key': key, 'label': labels[key] };
                    })

                    // Give the numeric column proper formatting.
                    columnFormatting['rate'] = {
                        alignRight: true,
                        isFixedWidth: true,
                        numDecimals: 3,
                        columnWidth: 7,
                        suffix: "%"
                    };

                    let table = prettyPrintArrayAsString(attractions, columnFormatting, headers, "=");
                    retStr = `${itemName} (loot) can be found the following ways:\n\`\`\`\n${table}\n\`\`\`\n`;
                    retStr += `HTML version at: <https://mhhunthelper.agiletravels.com/loot.php?item=${itemID}>`;
                } else
                    retStr = `${itemName} either hasn't been seen enough, or something broke.`;
                channel.send(retStr);
            });
            return;
        }

    // No matching item was found. If this was an item search, try finding a mouse.
    if (command === 'ifind')
        findMouse(channel, orig_args, command);
    else {
        channel.send(retStr);
        getMouseList();
    }
}

/**
 * Interrogate the local 'hunters' data object to find self-registered hunters that match the requested
 * criteria.
 *
 * @param {Message} message the Discord message that initiated this search
 * @param {string[]} searchValues an array of hids, snuids, or names/mentions to search for.
 * @param {string} type the method to use to find the member
 */
function findHunter(message, searchValues, type) {
    const noPM = ["hid", "snuid", "name"];
    if (!message.guild && noPM.indexOf(type) !== -1) {
        message.channel.send(`Searching by ${type} isn't allowed via PM.`);
        return;
    }

    let discordId;
    if (type === "name") {
        // Use message text or mentions to obtain the discord ID.
        let member = message.mentions.members.first() || message.guild.members
            .filter(member => member.displayName.toLowerCase() === searchValues[0].toLowerCase()).first();
        if (member)
            discordId = member.id;
    } else {
        // This is self-volunteered information that is tracked.
        discordId = getHunterByID(searchValues[0], type);
    }
    if (!discordId) {
        message.channel.send(`I did not find a registered hunter with \`${searchValues[0]}\` as a ${type === "hid" ? "hunter ID" : type}.`);
        return;
    }
    // Require that this Discord user has volunteered their information (i.e. the id appears in the 'hunters' object).
    const hunterId = getHunterByDiscordID(discordId);
    client.fetchUser(discordId)
        .then(user => {
            message.guild.fetchMember(user)
                .then(member => message.channel.send(`\`${searchValues[0]}\` is ${member.displayName} <https://mshnt.ca/p/${hunterId}>`))
                .catch(err => message.channel.send("That person may not be on this server."))
        })
        .catch(err => message.channel.send("That person may not have a Discord account any longer."));
}

/**
 * Unsets the hunter's id (and all other friend-related settings), and messages the user back.
 * Currently all settings are friend-related.
 *
 * @param {Message} message A Discord message object
 */
function unsetHunterID(message) {
    let hunter = message.author.id;
    if (hunters[hunter]) {
        delete hunters[hunter];
        message.channel.send(`*POOF*, you're gone!`);
    } else {
        message.channel.send("I didn't do anything but that's because you didn't do anything either.");
    }
}

/**
 * Sets the message author's hunter ID to the passed argument, and messages the user back.
 * 
 * @param {Message} message a Discord message object from a user
 * @param {string} hid a "Hunter ID" string, which should parse to a number.
 */
function setHunterID(message, hid) {
    let hunter = message.author.id;
    let message_str = "";
    if (isNaN(hid)) {
        message.channel.send(`I'm not sure that \`${hid}\` is a number so I am ignoring you.`);
        return;
    }

    // Initialize the data for any new registrants.
    if (!hunters[hunter]) {
        hunters[hunter] = {};
        console.log(" OMG! A new hunter " + hunter);
    }

    // If they already registered a hunter ID, update it.
    if (hunters[hunter]['hid']) {
        message_str = `You used to be known as \`${hunters[hunter]['hid']}\`. `;
        console.log("Found an old hid");
    }
    hunters[hunter]['hid'] = hid;
    message_str += `If people look you up they'll see \`${hid}\`.`;

    message.channel.send(message_str);
}

/**
 * Accepts a message object and hunter id, sets the author's hunter ID to the passed argument
 * 
 * @param {Message} message a Discord message object
 * @param {string} property the property key for the given user, e.g. 'hid', 'rank', 'location'
 * @param {any} value the property's new value.
 */
function setHunterProperty(message, property, value) {
    let hunter = message.author.id;
    if (!hunters[hunter] || !hunters[hunter]['hid']) {
        message.channel.send("I don't know who you are so you can't set that now; set your hunter ID first.");
        return;
    }

    let message_str = !hunters[hunter][property] ? "" : `Your ${property} used to be \`${hunters[hunter][property]}\`.`;
    hunters[hunter][property] = value;

    message_str += `Your ${property} is set to \`${value}\``;
    message.channel.send(message_str);
}

/**
 * Read the JSON datafile with hunter data, storing its contents in the 'hunters' global object.
 */
function loadHunters() {
    console.log(`Scheduling save for hunters every ~${refresh_rate.as('minutes')} minutes.`);
    // Do we need to do anything if saveHunters calls its reject()?
    dataTimers['hunters'] = setInterval(saveHunters,
        refresh_rate.as('milliseconds') * (Math.random() + 1));

    console.log("loading hunters");
    fs.readFile(hunter_ids_filename, file_encoding, (err, data) => {
        if (err) {
            // ENOENT -> File did not exist in the given location.
            if (err.code !== "ENOENT")
                console.log(err);
            return;
        }

        hunters = JSON.parse(data);
        console.log (Object.keys(hunters).length + " hunters loaded");
    });
}

/**
 * Read the JSON datafile with nickname URLs, storing its contents in the 'nickname_urls' global object
 */
function loadNicknameURLs() {
    console.log("loading nicknames");
    fs.readFile(nickname_urls_filename, file_encoding, (err, data) => {
        if (err) {
            // ENOENT -> File did not exist in the given location.
            if (err.code !== "ENOENT")
                console.log(err);
            return;
        }

        nickname_urls = JSON.parse(data);
        console.log(`${Object.keys(nickname_urls).length} nickname URLs loaded from disk.`);
        // Load all nicknames from all sources.
        nicknames = {};
        for (var key in nickname_urls)
            getNicknames(key);
    });
}

/**
 * Serialize the 'hunters' global object into a JSON datafile, replacing the target file.
 */
function saveHunters() {
    fs.writeFile(hunter_ids_filename, JSON.stringify(hunters, null, 1), file_encoding, err => {
        if (err) {
            reject();
            return console.log(err);
        }
        last_timestamps.hunter_save = DateTime.utc();
        console.log(`Hunters saved successfully at ${last_timestamps.hunter_save}.`);
    });
}

/**
 * Read the CSV exported from a Google Sheets file containing nicknames, and
 * initialize the specific 'nickname' property denoted by 'type'.
 * 
 * // TODO use the Google Sheets REST API or an Apps Script webapp for
 * better control / formatting (e.g. JSON output, referencing sheets by name)
 * 
 * @param {string} type The type of nickname to populate. Determines the sheet that is read.
 */
function getNicknames(type) {
    if (!nickname_urls[type]) {
        console.log(`Received '${type}' but I don't know that URL.`);
        return false;
    }
    nicknames[type] = {};
    // It returns a string as CSV, not JSON.
    request({
        url: nickname_urls[type]
    }, (error, response, body) => {
        if (!error && response.statusCode == 200) {
            let rows = body.split(/[\r\n]+/);
            let headers = rows.shift();
            for (let row of rows) {
                let cols = row.toLowerCase().split(',', 2);
                if (cols.length === 2)
                    nicknames[type][cols[0]] = cols[1];
            }
        }
        console.log(`Loaded ${Object.keys(nicknames[type]).length} nicknames of type '${type}'.`);
    });
}

/**
 * Find the first Discord account for the user with the given input property.
 * Returns undefined if no registered user has the given property.
 *
 * @param {string} input The property value to attempt to match.
 * @param {string} type Any stored property type (typically fairly-unique ones such as 'snuid' or 'hid').
 * @returns {string?} The discord ID, or undefined if the hunter ID was not registered.
 */
function getHunterByID(input, type) {
    for (let key in hunters)
        if (hunters[key][type] === input)
            return key;
}

/**
 * Find the self-registered account for the user identified by the given Discord ID.
 * Returns undefined if the user has not self-registered.
 * 
 * @param {string} discordId the Discord ID of a registered hunter.
 * @returns {string?} the hunter ID of the registered hunter having that Discord ID.
 */
function getHunterByDiscordID(discordId) {
    if (hunters[discordId])
        return hunters[discordId]["hid"]
}

/**
 * Find random hunter ids to befriend, based on the desired property and criterion.
 *
 * @param {string} property a hunter attribute, like "location" or "rank"
 * @param {string} criterion user-entered input.
 * @returns {string[]} an array of up to 5 hunter ids where the property value matched the user's criterion
 */
function getHuntersByProperty(property, criterion) {
    const valid = Object.keys(hunters)
        .filter(key => (hunters[key][property] === criterion))
        .map(key => (hunters[key].hid));

    return valid.sort(() => { return 0.5 - Math.random(); }).slice(0, 5);
}

/**
 * Convert the input number into a formatted string, e.g. 1234 -> 1,234
 * @param {number} number
 * @returns {string} A comma-formatted string.
 */
function integerComma(number) {
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * @typedef {Object} ColumnFormatOptions
 * @property {number} [columnWidth] The total width of the largest value in the column
 * @property {boolean} [isFixedWidth] If true, the input width will not be dynamically computed based on the values in the given column
 * @property {string} [prefix] a string or character which should appear in the column before the column's value. e.g. $
 * @property {string} [suffix] a string or character which should appear in the column after the column's value. e.g. %
 * @property {boolean} [alignRight] Whether the column should be right-aligned (default: left-aligned)
 * @property {boolean} [convertToPercent] Whether the value is a raw float that should be converted to a percentage value by multiplying by 100. (Does not add a % to the end)
 * @property {number} [numDecimals] For right-aligned values that are converted to percent, the number of decimals kept.
 */

/**
 * Given the input array and headers, computes a ready-to-print string that lines up the values in each column.
 * 
 * @param {Object <string, any>[]} body an array of object data to be printed.
 * @param {Object <string, ColumnFormatOptions>} columnFormat An array of objects that describe the formatting to apply to the given column in the output table.
 * @param {{key: string, label: string}[]} headers The headers which will label the columns in the output table, in the order to be arranged. The key property should
 *                                                 match a key in the body and columnFormat objects, and the label should be the desired column header text.
 * @param {string} [headerUnderline] a character to use to draw an "underline", separating the printed header row from the rows of the body.
 */
function prettyPrintArrayAsString(body, columnFormat, headers, headerUnderline) {
    // The body should be an array of objects.
    if (!body || !Array.isArray(body) || !Object.keys(body[0]).length)
        throw new TypeError(`Input body was of type ${typeof body}. Expected an array of objects.`);
    // The column formatter should be an object.
    if (!columnFormat || !Object.keys(columnFormat).length)
        throw new TypeError(`Input column formatter was of wrong type (or had no keys).`);
    // The headers should be an array of objects with at minimum 'key' and 'label' properties, of which 'key' must have a non-falsy value.
    if (!headers || !Array.isArray(headers) || !headers.every(col => (col.hasOwnProperty("key") && col.hasOwnProperty("label") && col.key)))
        throw new TypeError(`Input headers of incorrect type. Expected array of objects with properties 'key' and 'label'.`);
    // All object keys in the headers array must be found in both the body and columnFormat objects.
    let bodyKeys = body.reduce((acc, row) => { Object.keys(row).forEach(key => acc.add(key)); return acc; }, new Set());
    if (!headers.every(col => (bodyKeys.has(col.key) && columnFormat.hasOwnProperty(col.key))))
        throw new TypeError(`Input header array specifies non-existent columns.`);

    // Ensure that the column format prefix/suffix strings are initialized.
    for (let col in columnFormat) {
        ["prefix", "suffix"].forEach(key => {
            columnFormat[col][key] = columnFormat[col][key] || (columnFormat[col][key] === 0 ? "0" : "")
        });
    }

    // To pad the columns properly, we must determine the widest column value of each column.
    // Initialize with the width of the column's header text.
    for (let col of headers)
        if (!columnFormat[col.key].isFixedWidth)
            columnFormat[col.key].columnWidth = Math.max(col.label.length, columnFormat[col.key].columnWidth);

    // Then parse every row in the body. The column width will be set such that any desired prefix or suffix can be included.
    // If a column is specified as fixed width, it is assumed that the width was properly set.
    for (let row of body)
        for (let col in columnFormat)
            if (!columnFormat[col].isFixedWidth)
                columnFormat[col].columnWidth = Math.max(
                    columnFormat[col].columnWidth,
                    row[col].length + columnFormat[col].prefix.length + columnFormat[col].suffix.length
                );

    // Stringify the header information. Headers are center-padded if they are not the widest element in the column.
    const output = [];
    output.push(
        headers.reduce((row, col) => {
            let text = col.label;
            let diff = columnFormat[col.key].columnWidth - text.length;
            if (diff < 0)
                // This was a fixed-width column that needs to be expanded.
                columnFormat[col.key].columnWidth = text.length;
            else if (diff > 0)
                // Use padStart and padEnd to center-align this not-the-widest element.
                text = text.padStart(Math.floor(diff / 2) + text.length).padEnd(columnFormat[col.key].columnWidth);

            row.push(text);
            return row;
        }, []).join(" | ")
    );

    // If there is a underline string, add it.
    if (headerUnderline || headerUnderline === 0) {
        let text = String(headerUnderline).repeat(output[0].length / headerUnderline.length);
        text = text.substr(0, output[0].length);
        output.push(text);
    }

    // Add rows to the output.
    for (let row of body) {
        let rowText = [];
        // Fill the row's text based on the specified header order.
        for (let i = 0, len = headers.length; i < len; ++i) {
            let key = headers[i].key;
            let text = row[key].toString();
            let options = columnFormat[key];

            // If the convertToPercent flag is set, multiply the value by 100, and then drop required digits.
            // e.x. 0.123456 -> 12.3456
            // TODO: use Number.toLocaleString instead, with max fraction digits.
            if (options.convertToPercent) {
                text = parseFloat(text);
                if (!isNaN(text)) {
                    text = text * 100;
                    if (options.numDecimals === 0)
                        text = Math.round(text);
                    else if (!isNaN(parseInt(options.numDecimals, 10))) {
                        let factor = Math.pow(10, Math.abs(parseInt(options.numDecimals, 10)));
                        if (factor !== Infinity)
                            text = Math.round(text * factor) / factor;
                    }
                    // The float may have any number of decimals, so we should ensure that there is room for the prefix and suffix.
                    text = String(text).substr(0, options.columnWidth - options.suffix.length - options.prefix.length);
                }
                text = String(text);
            }

            // Add the desired prefix and suffix for this column, and then pad as desired.
            text = `${options.prefix}${text}${options.suffix}`;
            if (options.alignRight)
                text = text.padStart(options.columnWidth);
            else
                text = text.padEnd(options.columnWidth);
            rowText.push(text);
        }
        output.push(rowText.join(" | "));
    }
    return output.join("\n");
}

//Resources:
//Timezones in Discord: https://www.reddit.com/r/discordapp/comments/68zkfs/timezone_tag_bot/
//Location nicknames as csv: https://docs.google.com/spreadsheets/d/e/2PACX-1vQRxGO1iLgX6N2P2iUT57ftCbh5lv_cmnatC6F8NevrdYDtumjcIJw-ooAqm1vIjSu6b0HfP4v2DYil/pub?gid=0&single=true&output=csv
//Loot nicknames as csv:     https://docs.google.com/spreadsheets/d/e/2PACX-1vQRxGO1iLgX6N2P2iUT57ftCbh5lv_cmnatC6F8NevrdYDtumjcIJw-ooAqm1vIjSu6b0HfP4v2DYil/pub?gid=1181602359&single=true&output=csv
//Mice nicknames as csv:     https://docs.google.com/spreadsheets/d/e/2PACX-1vQRxGO1iLgX6N2P2iUT57ftCbh5lv_cmnatC6F8NevrdYDtumjcIJw-ooAqm1vIjSu6b0HfP4v2DYil/pub?gid=762700375&single=true&output=csv
