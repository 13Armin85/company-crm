declare module "jalaali-js" {
  export function toJalaali(gy: number, gm: number, gd: number): { jy: number; jm: number; jd: number };
  export function toGregorian(jy: number, jm: number, jd: number): { gy: number; gm: number; gd: number };
  export function jalaaliMonthLength(jy: number, jm: number): number;
  const jalaali: {
    toJalaali: typeof toJalaali;
    toGregorian: typeof toGregorian;
    jalaaliMonthLength: typeof jalaaliMonthLength;
  };
  export default jalaali;
}
