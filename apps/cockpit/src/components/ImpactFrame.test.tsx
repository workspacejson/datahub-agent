import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, describe, it } from "vitest";

import { CockpitShell } from "./CockpitShell";
import { createAdapter } from "../data/cockpit-adapter";
import { contractEvent } from "../test/contract-event";

afterEach(cleanup);

const shell = () => render(
  <CockpitShell
    model={createAdapter(contractEvent(), "fixture").read()}
    route="impact"
    onRouteChange={() => {}}
  />,
);

describe("the Impact frame spends its space on the join", () => {
  it("prints the subject URN once, with its source", () => {
    // It used to appear twice: once in the hero and again in a `Dataset
    // identity` card a hundred pixels below, which spent one of three slots in
    // the row that carries the join on a repetition.
    const model = createAdapter(contractEvent(), "fixture").read();
    shell();

    const urn = model.datasetIdentity.text;
    expect(screen.getAllByText(urn)).toHaveLength(1);

    // Removing the card must not take the attribution with it. An identifier on
    // a judge surface without the system that asserted it is the collapse this
    // cockpit exists to refuse.
    const hero = screen.getByLabelText("Dataset under review");
    expect(within(hero).getByText(model.datasetIdentity.source)).toBeTruthy();
  });

  it("keeps View Source inside the card for the file it links to", () => {
    // Standing between the card row and the lineage panel it read as unowned
    // page furniture, and nothing said which file it pointed at.
    shell();
    const producerCard = screen.getByLabelText("Producing file resolution");
    expect(within(producerCard).getByRole("link", { name: "View source at this revision" })).toBeTruthy();
  });

  it("lays lineage out by direction rather than as one flat list", () => {
    const model = createAdapter(contractEvent(), "fixture").read();
    shell();

    const band = screen.getByLabelText("Lineage topology");
    const upstream = model.impactEdges.filter((edge) => edge.direction === "upstream");
    const downstream = model.impactEdges.filter((edge) => edge.direction === "downstream");

    // The counts are rendered, so a reader sees the shape of the read without
    // counting rows.
    expect(within(band).getByText(`Upstream (${upstream.length})`)).toBeTruthy();
    expect(within(band).getByText(`Downstream (${downstream.length})`)).toBeTruthy();
    for (const edge of [...upstream, ...downstream]) {
      expect(within(band).getByText(edge.node)).toBeTruthy();
    }
  });

  it("states one shared source once instead of badging every node with it", () => {
    // Every node carrying a source is the rule that keeps a *mixed* read
    // readable. Repeating one value ten times distinguishes nothing and cost the
    // space the argument needed.
    const model = createAdapter(contractEvent(), "fixture").read();
    const sources = new Set(model.impactEdges.map((edge) => edge.source));
    expect(sources.size, "fixture should have one lineage source").toBe(1);

    shell();
    const band = screen.getByLabelText("Lineage topology");
    expect(within(band).getAllByText([...sources][0] as string)).toHaveLength(1);
  });
});
