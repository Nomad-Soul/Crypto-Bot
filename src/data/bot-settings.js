import App from '../app.js';
import EcaStacker from '../strategies/eca-stacker.js';
import EcaTrader from '../strategies/eca-trader.js';
import Strategy from '../strategies/strategy.js';

export default class BotSettings {
  id;
  account;
  /** @type {string} */
  strategyType;
  /** @type {Strategy} */
  strategy;
  crypto;
  active = false;
  maxPrice;
  maxBaseDigits = 8;
  maxQuoteDigits = 2;
  minDisplayDigits = 4;
  pair;
  quoteCurrency;
  badgeClass;
  options;
  userref;

  constructor(botId, data) {
    this.id = botId;
    try {
      this.account = data.account;
      this.strategyType = data.strategy;
      this.crypto = data.crypto;
      this.active = data.active ?? false;
      this.maxBaseDigits = data.maxBaseDigits;
      this.maxQuoteDigits = data.maxQuoteDigits;
      this.maxPrice = data.maxPrice;
      this.minDisplayDigits = data.minDisplayDigits;
      this.minVolume = data.minVolume;
      this.maxVolumeEur = data.maxVolumeEur;
      this.pair = data.pair;
      this.quoteCurrency = data.quoteCurrency;
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
      crypto: this.crypto,
      active: this.active ?? false,
      maxBaseDigits: this.maxBaseDigits,
      maxQuoteDigits: this.maxQuoteDigits,
      maxPrice: this.maxPrice,
      minDisplayDigits: this.minDisplayDigits,
      minVolume: this.minVolume,
      maxVolumeEur: this.maxVolumeEur,
      pair: this.pair,
      quoteCurrency: this.quoteCurrency,
      badgeClass: this.badgeClass,
      options: this.options,
      userref: this.userref,
    };
  }
}
