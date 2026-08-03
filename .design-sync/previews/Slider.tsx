import { Slider, Label } from "@packages/shared";

export const Single = () => (
  <div className="grid w-[380px] gap-2">
    <Label>Lautstärke</Label>
    <Slider defaultValue={[35]} max={100} step={5} />
  </div>
);

export const Range = () => (
  <div className="grid w-[380px] gap-2">
    <Label>Preisspanne</Label>
    <Slider defaultValue={[20, 70]} max={100} step={1} />
  </div>
);
