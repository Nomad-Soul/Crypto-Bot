import App from '../app/app.js';

export default class PairData {
  id;
  base;
  quote;
  minVolume;
  maxQuoteDigits;
  maxBaseDigits;
  minBaseDisplayDigits;
  nativeBaseId;
  nativeQuoteId;

  /** @type { {price: Number, amount: Number}} */
  precision;
  /** @type {Number} */
  takerFees;
  /** @type {Number} */
  makerFees;

  /**
   * @returns {Number}
   */
  get epsilon() {
    return Math.pow(10, -this.maxBaseDigits);
  }

  static alias = new Map([
    ['xxbtzeur', 'btc/eur'],
    ['xethzeur', 'eth/eur'],
    ['etheur', 'eth/eur'],
    ['xxrpzeur', 'xrp/eur'],
    ['xbteur', 'btc/eur'],
    ['xrpeur', 'xrp/eur'],
    ['xdgeur', 'doge/eur'],
    ['neareur', 'near/eur'],
    ['maticeur', 'matic/eur'],
    ['soleur', 'sol/eur'],
    ['adaeur', 'ada/eur'],
    ['doteur', 'dot/eur'],
    ['nanoeth', 'nano/eth'],
    ['ltceur', 'ltc/eur'],
  ]);

  /**
   * @param {{ id: string; base: string; quote: string; nativeBaseId: string; nativeQuoteId: string; minVolume: Number; maxBaseDigits: Number; maxQuoteDigits: Number; minBaseDisplayDigits: Number; takerFees?: Number; makerFees?: Number; precision: any}} data
   */
  constructor(data) {
    this.id = data.id;
    this.base = data.base;
    this.quote = data.quote;
    this.minVolume = data.minVolume;
    this.maxQuoteDigits = data.maxQuoteDigits;
    this.maxBaseDigits = data.maxBaseDigits;
    this.minBaseDisplayDigits = data.minBaseDisplayDigits;
    this.nativeBaseId = data.nativeBaseId;
    this.nativeQuoteId = data.nativeQuoteId;
    this.takerFees = data.takerFees;
    this.makerFees = data.makerFees;
    this.precision = data.precision;
  }

  static Get(pair) {
    if (!PairData.Has(pair)) {
      return pair;
    }

    return PairData.alias.get(pair);
  }

  static Has(pair) {
    return PairData.alias.has(pair);
  }

  static GetAliasCurrency(currency) {
    switch (currency.toLowerCase()) {
      case 'xxbt':
        return 'btc';

      case 'xeth':
      case 'eth2':
        return 'eth';

      case 'xxdg':
        return 'doge';

      case 'zeur':
        return 'eur';

      case 'xxrp':
        return 'xrp';

      default:
        return currency.toLowerCase();
    }
  }
}
