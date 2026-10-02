declare module "jalaali-js" {
  export interface JalaaliDate {
    jy: number;
    jm: number;
    jd: number;
  }

  export function toJalaali(gy: number, gm: number, gd: number): JalaaliDate;
  export function toGregorian(jy: number, jm: number, jd: number): { gy: number; gm: number; gd: number };
  export function jalaaliMonthLength(jy: number, jm: number): number;
}
