// Garchomple — fake the emulated DS clock.
// melonDS (compiled with Emscripten) reads the real-time clock through JS Date, so shifting Date
// shifts the in-game calendar. Black 2/White 2 only let you battle Cynthia in Undella during
// SPRING (January, May, September), and only once per in-game day, so we pin the calendar to
// noon on 15 May 2090 (then ticking normally): always spring, always later than whatever date is stored
// in the save (which forces the daily-event reset that re-enables her battle), and always the same day and
// light, so the Undella snapshot (snapshot.js) never sees the calendar move.
// Must be loaded BEFORE the emulator core starts.
(function () {
  if (window.__cynthialeClock) return;
  const RealDate = Date;
  const now = new RealDate();
  const target = new RealDate(2090, 4, 15, 12, 0, 0);
  const offset = target.getTime() - now.getTime();
  function FakeDate(...args) {
    if (!new.target) return new FakeDate().toString();
    if (args.length === 0) return new RealDate(RealDate.now() + offset);
    return new RealDate(...args);
  }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => RealDate.now() + offset;
  FakeDate.UTC = RealDate.UTC;
  FakeDate.parse = RealDate.parse;
  window.__RealDate = RealDate;
  window.__cynthialeClock = { offset, target };
  window.Date = FakeDate;
})();
