import EcaOrder from '../data/eca-order.js';
import App from '../app.js';
import BotSettings from '../data/bot-settings.js';
import ExchangeOrder from '../data/exchange-order.js';

export default class EcaPlanner {
  botId;
  /** @type {BotSettings} */
  botSettings;

  constructor(botId, botSettings) {
    this.botId = botId;
    this.botSettings = botSettings;
  }

  /**
   *
   * @param {Date} startDate
   * @param {Number} count
   * @returns {EcaOrder[]}
   */
  recurringPlan(startDate, count = 30) {
    var orders = [];
    var options = this.botSettings.options;
    const hourMilliseconds = 1000 * 60 * 60;

    var dateNow = new Date();
    if (dateNow.getTime() - startDate.getTime() > hourMilliseconds * options.frequency) startDate = dateNow;

    for (let i = 0; i < count; i++) {
      let nextDate = new Date(startDate.getTime() + (i + 1) * hourMilliseconds * options.frequency);

      orders[i] = new EcaOrder(
        {
          botId: this.botId,
          strategy: this.botSettings.strategyType,
          volumeQuote: this.botSettings.maxVolumeQuote,
          account: this.botSettings.account,
        },
        new ExchangeOrder({
          type: 'market',
          side: 'buy',
          status: 'planned',
          openDate: nextDate,
          price: 0,
          volume: 0,
          fees: 0,
          userref: this.botSettings.userref,
          pair: this.botSettings.pair,
        }),
      );

      if (orders[i].isValid()) continue;
    }

    return orders;
  }

  /**
   * @param {Date} startDate
   */
  monthlyPlan(startDate, count = 1) {
    var orders = [];
    var options = this.botSettings.options;

    for (let i = 0; i < count; i++) {
      let nextDate = null;
      try {
        nextDate = EcaPlanner.findDayOption(EcaPlanner.#findDayOfWeek(options.option), Number(options.day), startDate.getMonth(), startDate.getFullYear());
      } catch (e) {
        App.warning(startDate);
        App.error(`Invalid date in ${this.botId}`);
      }

      orders[i] = new EcaOrder(
        {
          botId: this.botId,
          strategy: this.botSettings.strategyType,
          volumeQuote: this.botSettings.maxVolumeQuote,
          account: this.botSettings.account,
        },
        new ExchangeOrder({
          type: 'market',
          side: 'buy',
          status: 'planned',
          openDate: nextDate,
          price: 0,
          volume: 0,
          fees: 0,
          userref: this.botSettings.userref,
          pair: this.botSettings.pair,
        }),
      );

      if (orders[i].isValid()) continue;
    }

    return orders;
  }

  /**
   * @param {EcaOrder} lastOrder
   */
  proposeNext(lastOrder) {
    var dateNow = new Date();
    var newOrders = [];
    if (this.botSettings.options.type === 'recurring') {
      newOrders = this.recurringPlan(lastOrder.order.closeDate, 1);
    } else if (this.botSettings.options.type === 'monthly') {
      if (lastOrder.order.closeDate.getMonth() === dateNow.getMonth()) {
        let nextMonth = new Date(dateNow.getFullYear(), dateNow.getMonth() + 1, 1);
        newOrders = this.monthlyPlan(nextMonth, 1);
      } else newOrders = this.monthlyPlan(dateNow, 1);
    }
    return newOrders;
  }

  static #findDayOfWeek(dayString) {
    var args = dayString.split('-');
    var dayOfWeek = args[1];
    switch (dayOfWeek.toLowerCase()) {
      case 'monday':
        return 1;
      case 'saturday':
        return 6;

      default:
        App.error(`Invalid day: ${dayOfWeek}`);
    }
  }

  /**
   *
   * @param {Number} dayOfWeek 0 (Sunday) to 6 (Saturday)
   * @param {Number} desiredDayOfMonth
   * @param {Number} month
   * @returns {Date}
   */
  static findDayOption(dayOfWeek, desiredDayOfMonth, month, year) {
    // console.log(`DayWeek: ${dayOfWeek} DayMonth: ${desiredDayOfMonth} Month: ${month}`);

    var target = new Date(year, month, desiredDayOfMonth, 0, 0, 0);
    var targetDay = target.getDay();

    var nextDesiredDay = desiredDayOfMonth + Math.abs(targetDay - dayOfWeek);
    var prevDesiredDay = nextDesiredDay - 7;

    var distances = [Math.abs(nextDesiredDay - desiredDayOfMonth), Math.abs(prevDesiredDay - desiredDayOfMonth)];

    var minValue = Math.min(...distances);
    var closestDay = distances.findIndex((e) => e === minValue) === 0 ? nextDesiredDay : prevDesiredDay;
    if (closestDay < 14) closestDay += 7;

    var chosenDate = new Date(target.getFullYear(), month, closestDay, 0, 0, 0);
    var nextDay = new Date(chosenDate.getTime() + 60000 * 60 * 24);

    return new Date(Math.random() * (nextDay.getTime() - chosenDate.getTime()) + chosenDate.getTime());
  }

  static addDays(date, increment) {
    var result = new Date(date);
    result.setDate(result.getDate() + increment);
    return result;
  }
}
