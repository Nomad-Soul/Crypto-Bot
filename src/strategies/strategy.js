import { yellowBright, cyanBright, redBright, greenBright } from 'ansis';
import App from '../app.js';
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
  accountClient;

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
    this.accountClient = this.bot.getClient(this.botSettings.account);
    this.pairData = this.accountClient.getPairData(this.botSettings.pair);
  }

  get bot() {
    return this.#bot;
  }

  get flags() {
    return this.#flags.entries();
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
   * @returns
   */
  hasActiveOrders() {
    return false;
  }

  requiresNewPlannedOrder() {
    return this.#bot.getPlannedOrders(this.botId).every((o) => o.isClosed);
  }

  /**
   * @param {number} [volumeEur]
   */
  balanceCheck(volumeEur) {
    if (typeof this.currentPrice === 'undefined') this.currentPrice = this.bot.getPrice(this.pairData.id);
    var accountClient = this.bot.getClient(this.botSettings.account);
    var availableBalance = accountClient.getBalance(this.pairData.quoteCurrency);
    volumeEur ??= this.botSettings.maxVolumeEur;
    var balanceCheck = availableBalance >= volumeEur;

    var maxQuoteDigits = this.pairData.maxQuoteDigits;
    if (isNaN(volumeEur)) {
      App.warning(`[${this.botId}] V: ${this.pairData.minVolume}`);
      App.printObject(this.botSettings.toJSON());
      return false;
    }

    try {
      this.logStatus(
        `Order for ${volumeEur.toFixed(maxQuoteDigits)} ${this.botSettings.quoteCurrency} (${(volumeEur / this.currentPrice).toFixed(this.pairData.maxBaseDigits)} ${this.pairData.baseCurrency}) ${balanceCheck ? greenBright`can` : redBright`cannot`} be executed at current market price`,
      );

      this.logStatus(
        `${this.pairData.id}: ${yellowBright`${this.currentPrice.toFixed(maxQuoteDigits)}`} Available: ${yellowBright`${availableBalance.toFixed(maxQuoteDigits)} ${this.pairData.quoteCurrency}`}`,
      );
    } catch (e) {
      App.warning('Unexpected error in balanceCheck');
      console.log([availableBalance, volumeEur, this.currentPrice]);
      return false;
    }

    return balanceCheck;
  }

  volumeCheck(volume) {
    var availableBalance = this.accountClient.getBalance(this.pairData.baseCurrency);
    var volumeCheck = availableBalance >= volume;
    var colour = volumeCheck ? greenBright : redBright;
    this.logStatus(
      `${this.pairData.id}: Requested ${yellowBright`${volume.toFixed(this.pairData.maxBaseDigits)}`} Available: ${colour`${availableBalance.toFixed(this.pairData.maxBaseDigits)} ${this.pairData.baseCurrency}`}`,
    );
    return volumeCheck;
  }

  decide() {
    App.error('Not implemented');
  }
}
