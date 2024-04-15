import App from '../app.js';
import Strategy from '../strategies/strategy.js';

export default class BotSettings {
  /** @type {string} */
  id;
  /** @type {string} */
  account;
  /** @type {string} */
  strategyType;
  /** @type {Strategy} */
  strategy;
  /** @type {string} */
  base;
  /** @type {string} */
  quote;
  /** @type {string} */
  pair;
  active = false;
  maxPrice;
  maxBaseDigits = 8;
  maxQuoteDigits = 2;
  minDisplayDigits = 4;

  badgeClass;
  options;
  userref;

  constructor(botId, data) {
    this.id = botId;
    try {
      this.account = data.account;
      this.strategyType = data.strategy;
      this.base = data.base;
      this.active = data.active ?? false;
      this.maxBaseDigits = data.maxBaseDigits;
      this.maxQuoteDigits = data.maxQuoteDigits;
      this.maxPrice = data.maxPrice;
      this.minDisplayDigits = data.minDisplayDigits;
      this.minVolume = data.minVolume;
      this.maxVolumeQuote = data.maxVolumeQuote;
      this.pair = data.pair;
      this.quote = data.quote;
      this.badgeClass = data.badgeClass;
      this.options = data.options;
      this.userref = data.userref;
    } catch (e) {
      App.error(`[${this.id}]: ${e.message}`);
    }
  }

  toJSON() {
    return {
      id: this.id,
      account: this.account,
      strategy: this.strategyType,
      base: this.base,
      quote: this.quote,
      pair: this.pair,
      active: this.active ?? false,
      maxBaseDigits: this.maxBaseDigits,
      maxQuoteDigits: this.maxQuoteDigits,
      maxPrice: this.maxPrice,
      minDisplayDigits: this.minDisplayDigits,
      minVolume: this.minVolume,
      maxVolumeQuote: this.maxVolumeQuote,
      badgeClass: this.badgeClass,
      options: this.options,
      userref: this.userref,
    };
  }
}
