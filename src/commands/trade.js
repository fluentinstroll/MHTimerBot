const Logger = require('../modules/logger');
const CommandResult = require('../interfaces/command-result');
const { initialize } = require('../modules/trade-db');

module.exports = {
    name: 'trade',
    args: true,
    aliases: ['mp', 'marketplace'],
    usage: 'Coming soon',
    description: 'Buy and sell from other players',
    canDM: true,
    execute: doTRADE,
    initialize: initialize,
};
