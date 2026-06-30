// Nav scroll effect
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 60);
});

// Triple-click logo → admin portal
// Uses sessionStorage so click count survives page navigations within the same tab.
document.querySelectorAll('.nav__logo').forEach(logo => {
  logo.addEventListener('click', e => {
    const now  = Date.now();
    let state  = {};
    try { state = JSON.parse(sessionStorage.getItem('_sk_lc') || '{}'); } catch {}
    if (now - (state.t || 0) > 1800) state.c = 0;   // reset after 1.8 s gap
    state.c = (state.c || 0) + 1;
    state.t = now;
    if (state.c >= 3) {
      sessionStorage.removeItem('_sk_lc');
      e.preventDefault();
      window.location.href = 'admin.html';
    } else {
      sessionStorage.setItem('_sk_lc', JSON.stringify(state));
    }
  });
});

// Hero photo zoom-in on load
const hero = document.querySelector('.hero');
if (hero) setTimeout(() => hero.classList.add('loaded'), 100);

const aboutHero = document.querySelector('.about-hero');
if (aboutHero) setTimeout(() => aboutHero.classList.add('loaded'), 100);

// FAQ accordion
document.querySelectorAll('.faq__question').forEach(btn => {
  btn.addEventListener('click', () => {
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    // Close all
    document.querySelectorAll('.faq__question').forEach(b => {
      b.setAttribute('aria-expanded', 'false');
      b.nextElementSibling.classList.remove('open');
    });
    // Open clicked if it was closed
    if (!expanded) {
      btn.setAttribute('aria-expanded', 'true');
      btn.nextElementSibling.classList.add('open');
    }
  });
});

// Smooth reveal on scroll
const observer = new IntersectionObserver(
  entries => entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.style.opacity = '1';
      e.target.style.transform = 'translateY(0)';
    }
  }),
  { threshold: 0.1 }
);

document.querySelectorAll('.feature, .ticket-card, .addon-item, .visit__detail').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(24px)';
  el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
  observer.observe(el);
});
