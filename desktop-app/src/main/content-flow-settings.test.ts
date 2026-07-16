import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

class FakeControl {
  id: string;
  textContent: string;
  title = "";
  private readonly attributes: Record<string, string>;

  constructor(id: string, textContent: string, attributes: Record<string, string>) {
    this.id = id;
    this.textContent = textContent;
    this.attributes = attributes;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  hasAttribute(name: string): boolean {
    return name in this.attributes;
  }

  getBoundingClientRect(): Record<string, number> {
    return { left: 10, top: 10, right: 130, bottom: 50, width: 120, height: 40 };
  }
}

test("confirms Flow LANDSCAPE and duration tabs by stable identity", async () => {
  const source = await readFile(
    resolve(process.cwd(), "../extension-worker/content-flow.js"),
    "utf8",
  );
  const controls: FakeControl[] = [];
  const windowValue: Record<string, unknown> = {};
  const context = {
    window: windowValue,
    document: {
      querySelectorAll: () => controls,
      querySelector: () => null,
    },
    chrome: {
      runtime: {
        onMessage: { addListener: () => {} },
        sendMessage: () => Promise.resolve(),
      },
    },
    console,
    setTimeout,
    clearTimeout,
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    Event: class {},
    InputEvent: class {},
    DataTransfer: class {},
    File: class {},
    HTMLElement: class {},
    HTMLTextAreaElement: class {},
  };
  vm.runInNewContext(source, context);

  const internals = windowValue.__FLOWX_FLOW_INTERNALS__ as {
    assetMatchesLocator: (
      control: FakeControl,
      locator: Record<string, unknown>,
      filenameHint: string,
    ) => boolean;
    cleanFlowOptionLabel: (control: FakeControl) => string;
    confirmVideoAspectRatio: () => Promise<Record<string, unknown>>;
    confirmVideoDuration: (seconds: number) => Promise<Record<string, unknown>>;
    findEndFrameButton: () => FakeControl | null;
    findStartFrameButton: () => FakeControl | null;
    getMediaModeOption: (mediaType: "image" | "video") => Promise<Record<string, unknown>>;
  };

  const landscape = new FakeControl(
    "radix-:r1cq:-trigger-LANDSCAPE",
    "crop_16_9 16:9",
    {
      "aria-controls": "radix-:r1cq:-content-LANDSCAPE",
      "aria-selected": "true",
      "data-state": "active",
    },
  );
  controls.push(new FakeControl(
    "radix-:r1lo:-trigger-PORTRAIT",
    "crop_9_16 9:16",
    {
      "aria-controls": "radix-:r1lo:-content-PORTRAIT",
      "aria-selected": "false",
      "data-state": "inactive",
    },
  ), landscape);
  assert.equal(internals.cleanFlowOptionLabel(landscape), "16:9");
  assert.deepEqual(
    { ...(await internals.confirmVideoAspectRatio()) },
    {
      ok: true,
      aspectRatio: "16:9",
      label: "16:9",
      identity: "radix-:r1cq:-trigger-LANDSCAPE radix-:r1cq:-content-LANDSCAPE",
    },
  );

  controls.length = 0;
  const imageMode = new FakeControl(
    "radix-:r15f:-trigger-IMAGE",
    "image Hình ảnh",
    {
      "aria-controls": "radix-:r15f:-content-IMAGE",
      "aria-selected": "false",
      "data-state": "inactive",
      role: "tab",
    },
  );
  controls.push(imageMode);
  const imageModeResult = await internals.getMediaModeOption("image");
  assert.equal(imageModeResult.ok, true);
  assert.match(String(imageModeResult.label), /Hình ảnh/);

  controls.length = 0;
  const startFrame = new FakeControl("", "Bắt đầu", {
    type: "button",
    "aria-haspopup": "dialog",
    "aria-expanded": "false",
  });
  const endFrame = new FakeControl("", "Kết thúc", {
    type: "button",
    "aria-haspopup": "dialog",
    "aria-expanded": "false",
  });
  controls.push(startFrame, endFrame);
  assert.equal(internals.findStartFrameButton(), startFrame);
  assert.equal(internals.findEndFrameButton(), endFrame);

  controls.length = 0;
  controls.push(new FakeControl(
    "radix-:test:-trigger-8",
    "8s",
    {
      "aria-controls": "radix-:test:-content-8",
      "aria-selected": "true",
      "data-state": "active",
    },
  ));
  assert.deepEqual(
    { ...(await internals.confirmVideoDuration(8)) },
    {
      ok: true,
      durationSeconds: 8,
      label: "8s",
      identity: "radix-:test:-trigger-8 radix-:test:-content-8",
    },
  );

  const gullitAsset = new FakeControl("asset-card", "", { alt: "Gullit.png" });
  assert.equal(
    internals.assetMatchesLocator(
      gullitAsset,
      { assetKey: "", rawSrc: "", hints: [] },
      "D:\\characters\\Gullit.png",
    ),
    true,
  );
});
