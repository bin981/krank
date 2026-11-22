export interface ViewState {
  mode: "solid" | "cutaway" | "xray";
  /** 0..1 */
  explode: number;
  labels: boolean;
  spin: boolean;
  /** Kesit düzleminin dünya Z konumu. */
  cut: number;
}
