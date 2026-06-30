(function () {
  const cfg = window.SKYLA_ADS || {};
  const tagId = cfg.googleTagId;

  if (tagId && !window.__skylaGoogleTagLoaded) {
    window.__skylaGoogleTagLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', tagId);

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(tagId)}`;
    document.head.appendChild(script);
  }

  function googleEvent(name, params) {
    if (typeof window.gtag !== 'function') return;
    window.gtag('event', name, params || {});
  }

  function googleConversion(label, params) {
    if (!label || typeof window.gtag !== 'function') return;
    window.gtag('event', 'conversion', {
      send_to: label,
      ...(params || {}),
    });
  }

  window.SkylaAds = {
    trackBeginCheckout(data) {
      const value = Number(data?.value) || 0;
      googleEvent('begin_checkout', {
        currency: 'USD',
        value,
        items: data?.items || [],
      });
      googleConversion(cfg.conversions?.beginCheckout, {
        currency: 'USD',
        value,
      });
    },

    trackPurchase(data) {
      const value = Number(data?.value) || 0;
      googleEvent('purchase', {
        transaction_id: data?.transactionId || '',
        currency: 'USD',
        value,
        items: data?.items || [],
      });
      googleConversion(cfg.conversions?.purchase, {
        transaction_id: data?.transactionId || '',
        currency: 'USD',
        value,
      });
    },

    trackLead(kind, data) {
      const conversionKey = kind === 'membership' ? 'membershipLead' : 'eventLead';
      googleEvent('generate_lead', {
        lead_type: kind || 'event',
        value: Number(data?.value) || undefined,
        currency: data?.value ? 'USD' : undefined,
      });
      googleConversion(cfg.conversions?.[conversionKey], {
        value: Number(data?.value) || 1,
        currency: 'USD',
      });
    },
  };
})();
