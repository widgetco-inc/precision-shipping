/* delivery-days.js
 * Injects EasyPost estimated delivery days into rate cards in the Estimator.
  * Intercepts /api/preview responses and reads rate.estDeliveryDays to display
   * "X bus. days" before the price column.
    */
(function () {
    'use strict';

    var _lastRates = [];

    function injectDeliveryDays() {
          if (!_lastRates.length) return;
          document.querySelectorAll('.est-rate-card').forEach(function (card) {
                  if (card.querySelector('.est-rate-delivery')) return;
                  var serviceEl = card.querySelector('.est-rate-service');
                  var priceEl = card.querySelector('.est-rate-price');
                  if (!serviceEl || !priceEl) return;
                  var match = _lastRates.find(function (r) {
                            return r.serviceName === serviceEl.textContent.trim();
                  });
                  if (!match || match.estDeliveryDays == null) return;
                  var d = match.estDeliveryDays;
                  var span = document.createElement('span');
                  span.className = 'est-rate-delivery';
                  span.textContent = d === 1 ? '1 bus. day' : d + ' bus. days';
                  card.insertBefore(span, priceEl);
          });
    }

    /* Intercept fetch to capture /api/preview responses */
    var _origFetch = window.fetch.bind(window);
    window.fetch = function () {
          var args = Array.prototype.slice.call(arguments);
          var url = typeof args[0] === 'string' ? args[0] : ((args[0] && args[0].url) || '');
          return _origFetch.apply(window, args).then(function (result) {
                  if (url.indexOf('/api/preview') !== -1) {
                            result.clone().json().then(function (data) {
                                        if (data.rates && data.rates.length) {
                                                      _lastRates = data.rates;
                                                      setTimeout(injectDeliveryDays, 200);
                                                      setTimeout(injectDeliveryDays, 700);
                                        }
                            }).catch(function () {});
                  }
                  return result;
          });
    };

    /* Watch for rate card DOM updates */
    var estOut = document.getElementById('estOut');
    if (estOut) {
          new MutationObserver(function () {
                  setTimeout(injectDeliveryDays, 50);
          }).observe(estOut, { childList: true, subtree: true });
    }
})();
