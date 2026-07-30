import sharkDevilMark from "../assets/shark-devil-mark.png";

export function BrandWordmark() {
  return (
    <span className="inline-flex items-center gap-2">
      <img alt="" className="h-7 w-12 object-contain" src={sharkDevilMark} />
      <span>SHark</span>
    </span>
  );
}
