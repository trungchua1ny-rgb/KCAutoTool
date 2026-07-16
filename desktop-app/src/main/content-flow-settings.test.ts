import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

class FakeControl {
  id: string;
  textContent: string;
  title = "";
  currentSrc = "";
  src = "";
  parentElement: FakeGroup | null = null;
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

class FakeGroup {
  parentElement: FakeGroup | null = null;

  constructor(private readonly controls: FakeControl[]) {
    for (const control of controls) control.parentElement = this;
  }

  querySelectorAll(): FakeControl[] {
    return this.controls;
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
    URL,
    location: { href: "https://labs.google/fx/tools/flow/project/test" },
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
    getVideoGenerationModeOption: (mode: "frames" | "ingredients") => Promise<Record<string, unknown>>;
    confirmVideoGenerationMode: (mode: "frames" | "ingredients") => Promise<Record<string, unknown>>;
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
  const workspaceImageMode = new FakeControl(
    "radix-:workspace:-trigger-IMAGE",
    "image Hình ảnh",
    {
      "aria-controls": "radix-:workspace:-content-IMAGE",
      "aria-selected": "false",
      "data-state": "inactive",
      role: "tab",
    },
  );
  const workspaceVideoMode = new FakeControl(
    "radix-:workspace:-trigger-VIDEO",
    "play_circle Video",
    {
      "aria-controls": "radix-:workspace:-content-VIDEO",
      "aria-selected": "true",
      "data-state": "active",
      role: "tab",
    },
  );
  new FakeGroup([workspaceImageMode, workspaceVideoMode]);
  const currentFrameMode = new FakeControl(
    "radix-:current:-trigger-IMAGE",
    "image Hình ảnh",
    {
      "aria-controls": "radix-:current:-content-IMAGE",
      "aria-selected": "true",
      "data-state": "active",
      role: "tab",
    },
  );
  const ingredientMode = new FakeControl(
    "radix-:current:-trigger-INGREDIENTS",
    "category Thành phần",
    {
      "aria-controls": "radix-:current:-content-INGREDIENTS",
      "aria-selected": "false",
      "data-state": "inactive",
      role: "tab",
    },
  );
  new FakeGroup([currentFrameMode, ingredientMode]);
  controls.push(workspaceImageMode, workspaceVideoMode, currentFrameMode, ingredientMode);
  const frameModeResult = await internals.getVideoGenerationModeOption("frames");
  assert.deepEqual(
    { ...frameModeResult },
    {
      ok: true,
      x: 70,
      y: 30,
      label: "image Hình ảnh",
      identity: "radix-:current:-trigger-IMAGE radix-:current:-content-IMAGE",
      alreadySelected: true,
    },
  );
  assert.deepEqual(
    { ...(await internals.confirmVideoGenerationMode("frames")) },
    {
      ok: true,
      mode: "frames",
      label: "image Hình ảnh",
      identity: "radix-:current:-trigger-IMAGE radix-:current:-content-IMAGE",
    },
  );

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

  const generatedAsset = new FakeControl("generated-card", "", {});
  generatedAsset.currentSrc = "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=d98ac0e8-d8fb-4d40-8f61-af21fbf6af46&size=thumbnail";
  assert.equal(
    internals.assetMatchesLocator(
      generatedAsset,
      {
        assetKey: "path:https://labs.google/fx/api/trpc/media.getMediaUrlRedirect",
        rawSrc: "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=d98ac0e8-d8fb-4d40-8f61-af21fbf6af46",
        hints: ["hình ảnh được tạo"],
      },
      "",
    ),
    true,
  );
});
