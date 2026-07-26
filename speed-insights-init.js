// Vercel Speed Insights - Inline initialization
// This injects the Speed Insights tracking script dynamically
(function() {
  'use strict';
  
  // Initialize queue for Speed Insights
  if (window.si) return;
  window.si = function(...params) {
    window.siq = window.siq || [];
    window.siq.push(params);
  };
  
  // Create and inject the tracking script
  const script = document.createElement('script');
  script.src = '/_vercel/speed-insights/script.js';
  script.defer = true;
  
  // Add SDK information
  script.dataset.sdkn = '@vercel/speed-insights';
  script.dataset.sdkv = '2.0.0';
  
  script.onerror = function() {
    console.log('[Vercel Speed Insights] Failed to load script. Please check if any content blockers are enabled and try again.');
  };
  
  document.head.appendChild(script);
})();
