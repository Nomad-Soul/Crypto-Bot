import BotSettings from './data/bot-settings.js';
/**
 * @typedef {Object} AccountSettings
 * @property {String} id
 * @property {String} type
 * @property {String} publicKey
 * @property {String} privateKey
 * @property {Number} makerFees
 * @property {Number} takerFees
 * @property {boolean} active
 * @property {Number} historyStartYear;
 * @property {string[]} watchBalance;
 */

/**
 * @typedef {Object} DealData
 * @property {number} averagePrice
 * @property {number} costBasis
 * @property {number} targetPrice
 * }
 */

/**
 * @typedef {Object} Settings
 * @property {Object.<string, BotSettings>} bots
 * @property {AccountSettings[]} accounts
 * @property {any[]} services
 * @property {string} locale
 * @property {Number} serverPort
 */