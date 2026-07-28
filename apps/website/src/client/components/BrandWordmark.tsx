import devilPhoneMark from "../assets/devil-phone-mark.png";

export function BrandWordmark() {
  return (
    <span className="inline-flex items-center gap-2">
      <img alt="" className="size-7 object-contain" src={devilPhoneMark} />
      <span>SHark</span>
    </span>
  );
}
