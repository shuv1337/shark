import type { ImageSourcePropType } from "react-native";

export interface AppIconOption {
  id: string;
  label: string;
  alternateName: string | null;
  image: ImageSourcePropType;
}

export const appIconOptions: readonly AppIconOption[] = [
  {
    id: "default",
    label: "SHark",
    alternateName: null,
    image: require("../../assets/icon.png"),
  },
  {
    id: "teal",
    label: "Teal",
    alternateName: "Teal",
    image: require("../../assets/app-icons/teal.png"),
  },
  {
    id: "blue",
    label: "Blue",
    alternateName: "Blue",
    image: require("../../assets/app-icons/blue.png"),
  },
  {
    id: "indigo",
    label: "Indigo",
    alternateName: "Indigo",
    image: require("../../assets/app-icons/indigo.png"),
  },
  {
    id: "violet",
    label: "Violet",
    alternateName: "Violet",
    image: require("../../assets/app-icons/violet.png"),
  },
  {
    id: "rose",
    label: "Rose",
    alternateName: "Rose",
    image: require("../../assets/app-icons/rose.png"),
  },
  {
    id: "red",
    label: "Red",
    alternateName: "Red",
    image: require("../../assets/app-icons/red.png"),
  },
  {
    id: "orange",
    label: "Orange",
    alternateName: "Orange",
    image: require("../../assets/app-icons/orange.png"),
  },
  {
    id: "gold",
    label: "Gold",
    alternateName: "Gold",
    image: require("../../assets/app-icons/gold.png"),
  },
  {
    id: "black",
    label: "Black",
    alternateName: "Black",
    image: require("../../assets/app-icons/black.png"),
  },
];

export function appIconLabel(alternateName: string | null): string {
  return appIconOptions.find((option) => option.alternateName === alternateName)?.label ?? "SHark";
}
