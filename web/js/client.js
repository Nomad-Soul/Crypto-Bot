document.addEventListener('DOMContentLoaded', function (event) {
  document.querySelectorAll('.nav-link').forEach(function (navLink) {
    navLink.addEventListener('click', function (e) {
      document.querySelectorAll('.nav-link').forEach((link) => link.classList.remove('active'));
      document.querySelectorAll('.tab').forEach((tab) => (tab.style.display = 'none'));
      document.getElementById(this.dataset.target).style.display = 'block';
      navLink.classList.add('active');
      if (navLink.getAttribute('data-target') != 'plannedOrders') document.getElementById('balance-container').parentElement.style.display = 'none';
      else document.getElementById('balance-container').parentElement.style.display = 'block';
    });
  });
  document.getElementById('btn-startDeal').addEventListener('click', (e) => submitRequest('StartDeal', { target: 'api', botId: 'bot-eth/eur' }));
});

/**
 *
 * @param {string} command
 * @param {any} data
 * @returns {Promise}
 */
async function submitRequest(command, data) {
  return new Promise(function (resolve, reject) {
    let xhr = new XMLHttpRequest();
    xhr.responseType = 'json';
    xhr.data = data;

    let mode = data.mode ?? 'GET';
    mode = mode.toUpperCase();
    let url = 'api';

    if (mode === 'GET') {
      url += `?endpoint=${command}`;
      let excludedKeys = ['mode', 'endpoint'];
      for (const [key, value] of Object.entries(data)) {
        if (excludedKeys.includes(key)) continue;
        url += `&${key}=${value}`;
      }
    }

    xhr.open(mode, url);
    xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
    xhr.setRequestHeader('accept', 'application/json');

    xhr.onload = function () {
      if (this.status >= 200 && this.status < 300) {
        resolve(xhr.response);
      } else {
        reject({
          status: this.status,
          statusText: xhr.statusText,
        });
      }
    };
    xhr.onerror = function () {
      reject({
        status: this.status,
        statusText: xhr.statusText,
      });
    };

    if (mode === 'POST') {
      if (typeof data.content.request === 'undefined') {
        data.content.request = command;
      }
      xhr.send(JSON.stringify(data.content));
    } else xhr.send();
    console.log(`[${command}]: sent ${mode} request`);
  });
}
