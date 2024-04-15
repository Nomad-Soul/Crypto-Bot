import App from './app.js';

export default class Utils {
  /**
   * @param {Date} date
   * @returns {string}
   */
  static toShortTime(date) {
    return date.toLocaleString(App.locale, {
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  }

  /**
   * @param {Date} date
   * @returns {string}
   */
  static toShortDate(date) {
    return date.toLocaleDateString(App.locale.id, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
  /**
   * @param {Date} date
   * @returns {string}
   */
  static toShortDateTime(date) {
    return date.toLocaleDateString(App.locale.id, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /**
   *
   * @param {Number} timeElapsed
   * @returns {string}
   */
  static timeToHoursOrDaysText(timeElapsed) {
    if (timeElapsed >= 24) {
      let days = timeElapsed / 24;
      return `${days.toFixed(2)} day${days != 1 ? 's' : ''}`;
    } else if (timeElapsed >= 1) return `${timeElapsed.toFixed(2)} hour${timeElapsed != 1 ? 's' : ''}`;
    else return `${Math.round(timeElapsed * 60)} minute${timeElapsed * 60 != 1 ? 's' : ''}`;
  }

  /**
   *
   * @param {Date} date
   * @returns {Number}
   */
  static getWeekNumber(date) {
    date.setHours(0, 0, 0, 0);
    // Thursday in current week decides the year.
    date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
    // January 4 is always in week 1.
    var week1 = new Date(date.getFullYear(), 0, 4);
    // Adjust to Thursday in week 1 and count number of weeks from date to week1.
    return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  }

  /**
   *
   * @param {Date} date
   * @returns {Number}
   */
  static getWeekYear(date) {
    date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
    return date.getFullYear();
  }
}
