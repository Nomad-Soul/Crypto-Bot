import { yellowBright, cyanBright, redBright, greenBright } from 'ansis';
import App from '../app.js';
import Utils from '../utils.js';
import fs from 'fs';
import CryptoBot from '../crypto-bot.js';
import BotSettings from '../data/bot-settings.js';
import EcaOrder from '../data/eca-order.js';
import PairData from '../data/pair-data.js';
import ClientBase from '../services/client.js';

export default class Strategy {
  /** @type {CryptoBot} */
  #bot;
  botId;
  /** @type {BotSettings} */
  botSettings;
  /** @type {ClientBase} */
  client;

  /** @type {PairData} */
  pairData;
  /** @type {string[]} */
  statusMessages = [];
  lastResult;

  /** @type {Number} */
  currentPrice;

  /** @type {Map<string, EcaOrder>} */
  #flags = new Map();
  strategyOrders = {};
  #lastHistoryCheck;

  /**
   *
   * @param {CryptoBot} bot
   * @param {string} botId
   */
  constructor(bot, botId) {
    if (this.constructor == Strategy) {
      throw new Error('Class is abstract type and cannot be instantiated');
    }
    if (typeof bot === 'undefined') throw new Error('Invalid argument: bot');
    this.#bot = bot;
    this.botId = botId;
    this.botSettings = bot.getBotSettings(botId);
    this.client = this.#bot.getClient(this.botSettings.account);
    this.pairData = this.client.getPairData(this.botSettings.pair);

    let path = `${App.DataPath}/${this.botSettings.account}/${this.botSettings.strategyType.replace('eca-', '')}-${this.botId.replace('/', '-')}.json`;
    if (fs.existsSync(path)) {
      this.strategyOrders = App.readFileSync(path);
      this.#lastHistoryCheck = this.strategyOrders['lastCheck'];
      delete this.strategyOrders['lastCheck'];
    } else {
      this.rebuildHistory();
    }
  }

  get bot() {
    return this.#bot;
  }

  get flags() {
    return this.#flags.entries();
  }

  checkHistory() {
    //if (c)
  }

  /**
   * @param {EcaOrder} value
   * @param {any} key
   * @returns
   */
  setFlag(key, value) {
    var name = Object.keys(key)[0];
    if (typeof name === 'undefined') {
      App.warning('Invalid flag');
      return;
    }

    this.#flags.set(name, value);
  }

  clearFlag(key) {
    var name = Object.keys(key)[0];
    if (typeof name === 'undefined') {
      App.warning('Invalid flag');
      return;
    }
    this.#flags.delete(name);
  }

  clearFlags() {
    this.#flags.clear();
  }

  logStatus(message, severity = 'info') {
    this.statusMessages.push(App.stripAnsi(message));
    switch (severity) {
      case 'infoTimestamp':
        App.log(message, true);
        break;

      case 'info':
        App.log(message);
        break;
      case 'warning':
        App.warning(message);
        break;

      case 'errorNonBlocking':
        App.log(message, true, redBright);
        break;
    }
    return message;
  }

  /**
   *
   * @returns {Boolean}
   */
  hasActiveOrders() {
    App.error(`${this.botSettings.fullId}: <${Utils.functionName()}> not implemented`);
    return false;
  }

  requiresNewPlannedOrder() {
    return this.getPlannedOrders(this.botId).every((o) => o.isExecuted);
  }

  /**
   * @param {number} [volumeQuote]
   * @param {string} balanceLabel
   */
  balanceCheck(volumeQuote, balanceLabel = null) {
    if (typeof this.currentPrice === 'undefined') this.currentPrice = this.client.getPrice(this.pairData.id);
    var accountClient = this.bot.getClient(this.botSettings.account);
    if (balanceLabel == null) balanceLabel = this.pairData.quote;
    var availableBalance = accountClient.getBalance(balanceLabel);
    volumeQuote ??= this.botSettings.maxVolumeQuote;
    var balanceCheck = availableBalance >= volumeQuote;

    var maxQuoteDigits = this.pairData.maxQuoteDigits;
    if (isNaN(volumeQuote)) {
      App.warning(`[${this.botId}] V: ${this.pairData.minVolume}`);
      App.printObject(this.botSettings.toJSON());
      return false;
    }

    //try {
    this.logStatus(
      `Order for ${volumeQuote.toFixed(maxQuoteDigits)} ${this.botSettings.quote} (${(volumeQuote / this.currentPrice).toFixed(this.pairData.maxBaseDigits)} ${this.pairData.base}) ${balanceCheck ? greenBright`can` : redBright`cannot`} be executed at current market price`,
    );

    this.logStatus(
      `${this.pairData.id}: ${yellowBright`${this.currentPrice.toFixed(maxQuoteDigits)}`} Available: ${yellowBright`${availableBalance.toFixed(maxQuoteDigits)} ${this.pairData.quote}`}`,
    );
    // } catch (e) {
    //   App.warning('Unexpected error in balanceCheck');
    //   console.log(this.pairData);
    //   console.log([availableBalance, volumeQuote, this.currentPrice]);
    //   App.error(e, true);
    //   return false;
    // }

    return balanceCheck;
  }

  /**
   * @param {string} statusFilter
   * @returns {EcaOrder[]}
   */
  getPlannedOrders(statusFilter = undefined) {
    var data = [];
    for (let [status, orders] of Object.entries(this.strategyOrders)) {
      if (statusFilter !== undefined && statusFilter !== status) continue;
      for (let orderTxid of orders) {
        let order = this.client.getLocalOrder(orderTxid);
        data.push(
          new EcaOrder(
            {
              botId: this.botId,
              account: this.client.id,
              strategy: this.botSettings.strategyType,
            },
            order,
          ),
        );
      }
    }
    return data;
  }

  /**
   *
   * @param {string} txid
   * @returns {EcaOrder}
   */
  getPlannedOrder(txid) {
    return new EcaOrder(
      {
        botId: this.botId,
        account: this.client.id,
        strategy: this.botSettings.strategyType,
      },
      this.client.getLocalOrder(txid),
    );
  }

  /**
   *
   * @param {Number} volume
   * @param {Boolean} alternate
   * @returns {Boolean}
   */
  volumeCheck(volume, alternate = false) {
    let volumeLabel = alternate ? this.botSettings.alternateBase : this.pairData.base;
    var availableBalance = this.client.getBalance(volumeLabel);
    var volumeCheck = availableBalance >= volume;
    var colour = volumeCheck ? greenBright : redBright;
    this.logStatus(
      `${this.pairData.id}: Requested ${yellowBright`${volume.toFixed(this.pairData.maxBaseDigits)}`} Available: ${colour`${availableBalance.toFixed(this.pairData.maxBaseDigits)} ${volumeLabel}`}`,
    );
    return volumeCheck;
  }

  decide() {
    App.error(`${this.botSettings.fullId}: <${Utils.functionName()}> not implemented`);
  }

  rebuildHistory() {
    App.warning(`${this.botSettings.fullId}: <${Utils.functionName()}> not implemented`);
  }
}
