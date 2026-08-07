import type { Canal } from "@/types/domain";

const COLOR: Record<Canal, string> = {
  wa: "#25D366",
  ig: "#E1306C",
  fb: "#1877F2",
};

const LABEL: Record<Canal, string> = {
  wa: "WhatsApp",
  ig: "Instagram",
  fb: "Messenger",
};

export function canalColor(canal: Canal): string {
  return COLOR[canal];
}

export function canalLabel(canal: Canal): string {
  return LABEL[canal];
}
