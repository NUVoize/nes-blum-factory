// Original pixel monogram: a 9x9 flower ("bloom"), drawn as SVG rects. No emoji, no icon font.
const ROWS = [
  '...ppp...',
  '..pPPPp..',
  'ppPyyyPpp',
  'pPPyYyPPp',
  '.pPyyyPp.',
  '..ppgpp..',
  '.gg.g....',
  '..ggg.gg.',
  '....ggg..',
];

const COLORS: Record<string, string> = {
  p: 'var(--c-bloom-dark)',
  P: 'var(--c-bloom)',
  y: 'var(--c-gold)',
  Y: 'var(--c-cream)',
  g: 'var(--c-leaf)',
};

const PIXELS = ROWS.flatMap((row, y) =>
  [...row].flatMap((c, x) => (c === '.' ? [] : [{ x, y, fill: COLORS[c] }])),
);

export function BloomMark({ size = 72 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 9 9" shapeRendering="crispEdges" aria-hidden="true">
      {PIXELS.map(({ x, y, fill }) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />
      ))}
    </svg>
  );
}
