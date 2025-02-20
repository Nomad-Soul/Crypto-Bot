import BotSettings from './data/bot-settings.js';
import EcaOrder from './data/eca-order.js';
import ExchangeOrder from './data/exchange-order.js';
/**
 * @typedef {Object} AccountSettings
 * @property {String} id
 * @property {String} type
 * @property {String} publicKey
 * @property {String} privateKey
 * @property {Number} makerFees
 * @property {Number} takerFees
 * @property {boolean} active
 * @property {Number} historyStartYear
 * @property { {botId: string}[]} showDealPreview
 * @property { {botId: string, interval: Number, startDate : Date}} purchaseHistory
 * @property { {botId: string}[]} stackingHistory
 * @property { {botId: string, groupBy: String}[]} tradeBalance
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
 * @property {string} lastClosedOrderCheck;
 */

/**
 * @callback postExecutionCallback
 * @param {{order: ExchangeOrder, result: Boolean}} response
 * @returns {ExchangeOrder}
 */
