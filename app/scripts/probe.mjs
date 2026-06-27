// One-off probe: submit a real transcript to the running server, wait, save the report.
import { writeFileSync } from 'node:fs';

const transcript =
  'We stand at a critical crossroads. Climate change is ravaging our planet, and our only escape is a complete transition to green energy. But green tech requires batteries, and batteries require cobalt and nickel. The land-based mines in Congo are hotbeds of human rights violations and environmental devastation. Yet four thousand meters below the Pacific Ocean lie billions of tons of these metals as polymetallic nodules. Harvesting these nodules is virtually impact-free. Mining companies are being held back by bureaucrats and radical environmentalists who care more about deep-sea worms than the future of humanity. If we do not mine the seabed now, we doom ourselves to global warming.';

const base = 'http://localhost:4000/api/v1/analyses';

const submit = await fetch(base, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sourceType: 'transcript', transcript }),
});
const { reportId } = await submit.json();

let report;
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  report = await (await fetch(`${base}/${reportId}`)).json();
  if (['ready', 'failed', 'needs_review'].includes(report.status)) break;
}

writeFileSync(new URL('./probe-out.json', import.meta.url), JSON.stringify(report, null, 2));
console.log('done:', report.status, 'claims=', report.claims?.length, 'framing=', report.framingSignals?.length);
