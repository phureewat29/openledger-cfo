import { describe, expect, it } from "vitest";

import { fitScale, legendHeight } from "./sankey";

describe("legendHeight", () => {
  it("is zero for a legend with nothing to list", () => {
    expect(legendHeight([], 678)).toBe(0);
  });

  it("packs entries along a line before it starts the next", () => {
    expect(
      legendHeight(
        [
          "12 mo avg",
          "Dividend Income ฿1,881",
          "1 Housing ฿23,110",
          "2 Travel ฿19,772",
          "3 Household ฿18,750",
          "4 Transport ฿17,574",
          "5 Leisure ฿17,353",
        ],
        678,
      ),
    ).toBe(39);
  });

  it("gives an entry wider than the list the lines its words wrap to", () => {
    expect(
      legendHeight(
        [
          "1 SCB Home Loan — Life Asoke Rama 9 ฿10,934",
          "2 Insurance ฿9,100",
          "3 Leisure ฿7,000",
          "4 Other ฿8,497",
        ],
        230,
      ),
    ).toBe(74);
  });

  // 39 is the height Chrome lays this list out at with Geist Mono loaded.
  it("gives Thai vowel and tone marks no width of their own", () => {
    expect(
      legendHeight(
        [
          "12 mo avg",
          "1 ค่าใช้จ่ายในบ้าน ฿23,110",
          "2 ค่าเดินทางและท่องเที่ยว ฿19,772",
          "3 อาหารและเครื่องดื่ม ฿18,750",
          "เงินปันผล กองทุนรวม ฿1,881",
          "4 ผ่อนบ้าน ธนาคารไทยพาณิชย์ สาขาอโศก ฿10,934",
        ],
        636,
      ),
    ).toBe(39);
  });
});

describe("fitScale", () => {
  it("reads the frame alone when there is no legend", () => {
    expect(fitScale({ w: 652.7, h: 294.2 }, () => 0)).toBe(0.6);
  });

  it("sizes for the plot the legend leaves", () => {
    expect(fitScale({ w: 652.7, h: 294.2 }, () => 20.5)).toBe(0.55);
    expect(fitScale({ w: 678, h: 258 }, () => 20.5)).toBe(0.5);
  });

  it("settles a legend that would flip the scale on its smaller side", () => {
    const legendAt = (scale: number) => (scale === 0.25 ? 150 : 131);
    expect(fitScale({ w: 285, h: 258 }, legendAt)).toBe(0.2);
  });
});
