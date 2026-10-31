/** 24 bars, one per hour, oldest first (#109). Plain SVG; the label carries the numbers for screen readers. */
export function HourBars(props: { values: readonly number[]; label: string; unit: string }) {
  const { values } = props;
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  const w = 6;
  const gap = 2;
  const height = 40;
  return (
    <figure class="hour-bars">
      <svg viewBox={`0 0 ${values.length * (w + gap)} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${props.label}: ${total.toLocaleString()} ${props.unit} in 24 hours, at most ${max.toLocaleString()} in one hour`}>
        {values.map((v, i) => {
          const h = v > 0 ? Math.max(1, (v / max) * height) : 0;
          return <rect key={i} x={i * (w + gap)} y={height - h} width={w} height={h} rx={1} />;
        })}
      </svg>
      <figcaption class="hint">
        {props.label}, last 24 hours (now at the right) · most in one hour: {max.toLocaleString()}
      </figcaption>
    </figure>
  );
}
