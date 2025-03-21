import { yellowBright, cyanBright, redBright, greenBright } from 'ansis';
import App from '../app/app.js';
import Utils from '../utils.js';
import CryptoBot from '../crypto-bot.js';
import BotSettings from '../data/bot-settings.js';
import EcaOrder from '../data/eca-order.js';
import PairData from '../data/pair-data.js';
import ClientBase from '../services/client.js';
import ExchangeOrder from '../data/exchange-order.js';
import Terminal from '../app/terminal.js';
import Action from '../data/action.js';

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
      Terminal.instance.warning('Invalid flag');
      return;
    }

    this.#flags.set(name, value);
  }

  clearFlag(key) {
    var name = Object.keys(key)[0];
    if (typeof name === 'undefined') {
      Terminal.instance.warning('Invalid flag');
      return;
    }
    this.#flags.delete(name);
  }

  clearFlags() {
    this.#flags.clear();
  }

  /**
   * @param {string} message
   */
  logStatus(message, severity = 'info') {
    this.statusMessages.push(Terminal.stripAnsi(message));
    switch (severity) {
      case 'infoTimestamp':
        Terminal.log(message, true);
        break;

      case 'info':
        Terminal.log(message);
        break;
      case 'warning':
        Terminal.warning(message);
        break;

      case 'errorNonBlocking':
        Terminal.log(message, true, redBright);
        break;
    }
    return message;
  }

  /**
   *
   * @returns {Boolean}
   */
  hasActiveOrders() {
    Terminal.error(`${this.botSettings.fullId}: <${Utils.functionName()}> not implemented`);
    return false;
  }

  /**
   * @callback cancelCallback
   * @param {ExchangeOrder} order
   */
  /**
   *
   * @param {Action} action
   * @param {cancelCallback} cancelCallback
   */
  async awaitConfirmation(action, cancelCallback) {
    let order = action.plannedOrder.order;
    var term = Terminal.instance;

    term.log('\r');
    var actionLabel = '';
    switch (action.command) {
      case 'submitOrder':
        term.log(`^[bg:red]      ^ ^rCreating new order^: ^[bg:red]      `);
        break;
      case 'editOrder':
        term.log(`^[bg:Yellow]      ^ ^rEditing order^: ^[bg:Yellow]      `);
        break;
      case 'cancelOrder':
        actionLabel = action.command.replace('Order', '');
        break;
    }

    term.log(`^R--> ${actionLabel}^ ${order.toString(this.pairData)}`);

    var r = await term.yesOrNo('Proceed?', 2);
    term.resetPrompt();
    if (r) {
      return this.client.executeActions([action]);
    } else {
      cancelCallback(order);
      term.log('Action cancelled');
    }
  }

  /**
   * @param {number} [volumeQuote]
   * @param {string} balanceLabel
   */
  balanceCheck(volumeQuote, balanceLabel = null) {
    var term = Terminal.instance;
    if (typeof this.currentPrice === 'undefined') this.currentPrice = this.client.getPrice(this.pairData.id);
    var client = this.bot.getClient(this.botSettings.account);

    if (balanceLabel == null) balanceLabel = this.pairData.quote;

    var availableBalance = client.getBalance(balanceLabel);
    if (availableBalance == 0 && this.botSettings.alternateQuote) availableBalance = client.getBalance(this.botSettings.alternateQuote);

    volumeQuote ??= this.botSettings.maxVolumeQuote;
    var balanceCheck = availableBalance >= volumeQuote;

    var maxQuoteDigits = App.locale.minQuoteDigits;
    if (isNaN(volumeQuote)) {
      term.warning(`[${this.botId}] V: ${this.pairData.minVolume}`);
      term.printObject(this.botSettings.toJSON());
      return false;
    }

    term.log(
      `^GBuy^ order for ^R${volumeQuote.toFixed(maxQuoteDigits)}^ ${this.botSettings.quote.toUpperCase()} (^C${(volumeQuote / this.currentPrice).toFixed(this.pairData.maxBaseDigits)}^ ${this.pairData.base.toUpperCase()}) ${balanceCheck ? `^Gcan` : `^Rcannot`}^ be executed at current market price`,
    );

    term.log(
      `Current price: ^y${this.currentPrice.toFixed(maxQuoteDigits)}^ ${this.pairData.quote.toUpperCase()} | Available balance: ^Y${availableBalance.toFixed(maxQuoteDigits)}^ ${this.pairData.quote.toUpperCase()}`,
    );

    return balanceCheck;
  }

  /**
   * @param {string} statusFilter
   * @returns {Promise<EcaOrder[]>}
   */
  async getPlannedOrders(statusFilter = undefined) {
    return null;
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
    var term = Terminal.instance;
    let volumeLabel = alternate ? this.botSettings.alternateBase : this.pairData.base;
    var availableBalance = this.client.getBalance(volumeLabel);
    var volumeCheck = availableBalance >= volume;
    var colour = volumeCheck ? '^G' : '^R';
    term.log(
      `Bot ${this.botId}: requested ^y${volume.toFixed(this.pairData.maxBaseDigits)} Available: ${colour}${availableBalance.toFixed(this.pairData.maxBaseDigits)}^ ${volumeLabel.toUpperCase()}`,
    );
    return volumeCheck;
  }

  /**
   * @returns {Promise<any>}
   */
  async decide() {
    Terminal.error(`${this.botSettings.fullId}: <${Utils.functionName()}> not implemented`);
    return null;
  }

  rebuildHistory() {
    Terminal.warning(`${this.botSettings.fullId}: <${Utils.functionName()}> not implemented`);
  }
}
