/**
 * The logo (the favicon, served from public/) and the app's name, for the header. The image is
 * decorative (`alt=""`): the name beside it already says what it is, so a screen reader reads
 * "OFP Lens" once, and a link around it is still named "OFP Lens".
 */
export function Brand() {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight">
      <img src="/favicon.svg" alt="" width={22} height={22} className="shrink-0" />
      OFP Lens
    </span>
  );
}
