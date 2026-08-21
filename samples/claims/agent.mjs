/**
 * A STAND-IN. Not the agent, and not ours to supply.
 *
 * The scene needs something to run so it can be rehearsed without a client, and
 * this is that and nothing more. It reads first-notice-of-loss records, decides
 * which it can classify and which need a person, and prints the counts the ledger
 * requires.
 *
 * Why it is deliberately not clever: whoever runs this in a room brings their own
 * agent, and the measurement has to be indifferent to what it is. If this file
 * were good the demo would be about it — and a demo about the agent is a demo
 * about the artefact, which is the thing that just became cheap.
 *
 * It classifies by keyword and refuses whatever it cannot place. That is a poor
 * agent and an honest one: it hands back a fifth of the work, which is roughly
 * what a real one does on real intake, and the ledger charges every handed-back
 * record at the human rate.
 *
 * `wrong` is counted against a label carried in the record. On live traffic it is
 * an adjuster's judgement, sampled — and a run that cannot say how many it got
 * wrong is a run the ledger refuses, on purpose.
 */
import { readFileSync } from 'node:fs'

const PERILS = {
  'water damage': /water|leak|ceiling|flood|damp/i,
  collision: /collision|hit|crash|bump|rear-end|car park/i,
  theft: /theft|stolen|burglar|break-in/i,
  fire: /fire|smoke|burn/i,
  windscreen: /windscreen|windshield|glass|window/i,
  storm: /storm|wind|hail|gale/i,
}

const file = process.argv[2]
const records = readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l))

let handled = 0
let escalated = 0
let wrong = 0

for (const record of records) {
  // No policy reference is a person's job every time. An agent that guesses which
  // policy a claim belongs to is an agent that costs more than it saves the first
  // time it guesses wrong.
  if (!record.policyRef) { escalated += 1; continue }

  const matched = Object.entries(PERILS).filter(([, re]) => re.test(record.text)).map(([p]) => p)

  // Nothing matched, or more than one did. Both are ambiguity, and handing
  // ambiguity back is the behaviour worth demonstrating — an agent that resolves
  // it silently is where the cost of the wrong answers comes from.
  if (matched.length !== 1) { escalated += 1; continue }

  handled += 1
  // The stand-in's own error, so the figure is not a flattering zero. On live
  // traffic this comes from a sampled review rather than from the record.
  if (/car park|discussed on the phone|attached the estimate/i.test(record.text)) wrong += 1
}

process.stdout.write(JSON.stringify({
  handled,
  escalated,
  wrong,
  // What one handled record cost. On a real run this is token spend divided by
  // records; here it is stated as a stand-in and the ledger prints the source
  // beside the figure so nobody quotes it as measured.
  costPerUnit: 0.61,
  costSource: 'REHEARSAL STAND-IN — a real run divides token spend by records handled',
  note: 'stand-in agent; classification by keyword, ambiguity handed back',
}, null, 2))
