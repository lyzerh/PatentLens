import { resolve } from "node:path";
import { PilotStore } from "../src/pilot/records.ts";

const store = new PilotStore(resolve(process.env.PATENT_PILOT_DATA || "data/pilot.json"));
const result = await store.transaction(state => {
  let corrected = 0;
  for (const audit of Object.values(state.pilotV3?.sourceAudit ?? {})) {
    const record = state.records.find(r => r.publicationNumber === audit.publicationNumber);
    if (!record) continue;
    for (const field of Object.values(audit.fields)) for (const observation of field.observations) {
      if (!["epo_index_metadata", "epo_publication_xml_prior_capture"].includes(observation.source) || !observation.sourceVersion.startsWith("epo_xml:")) continue;
      const expected = observation.retrievedAt > record.importedAt ? "epo_publication_xml_prior_capture" : "epo_index_metadata";
      if (observation.source !== expected) { observation.source = expected; corrected++; }
    }
  }
  return { corrected, datasetVersion: state.pilotV3?.dataset?.version ?? null };
});
process.stdout.write(JSON.stringify(result) + "\n");
