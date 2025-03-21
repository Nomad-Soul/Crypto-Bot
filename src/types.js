import Action from './data/action.js';
import BotSettings from './data/bot-settings.js';
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
 * @property {string} strategyType
 * @property {string} lastClosedOrdersCheck;
 * @property {string} lastOpenOrdersCheck;
 */

/**
 * @typedef {Object} DealData
 * @property {number} averageCost
 * @property {number} costBasis
 * @property {number} targetPrice
 * }
 */

/**
 * @typedef {Object} Settings
 * @property {Object.<string, BotSettings>} bots
 * @property {AccountSettings[]} accounts
 * @property {{telegram?: any, coinmarketcap?: any}} services
 * @property {{id: string, timezone: string, currency: string}} locale
 * @property {Number} serverPort
 */

/**
 * @callback postExecutionCallback
 * @param {{order: ExchangeOrder, action: Action, result: Boolean}} response
 */

/**
 * @typedef {Object} BotOptions
 * @property {Number?} initialOrderSize
 * @property {Number?} safetyOrder
 * @property {Number?} maxSafetyOrders
 * @property {Number?} priceDeviation
 * @property {Number?} safetyOrderStepScale
 * @property {Number?} safetyOrderVolumeScale
 * @property {Number?} profitTarge
 * @property {Number?} volumeUpdateThreshold
 * @property {string?} type
 * @property {Number?} maxOrdersPerDay
 * @property {Number?} frequency
 * @property {string?} option
 * @property {Number?} day
 */
