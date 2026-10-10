import { describe, expect, it } from "vitest";
import {
  activeOverride,
  currentShift,
  isValidTimeZone,
  nextInRotation,
  normalizeRotationStart,
  onCallThroughout,
  type RotationConfig,
  rotationIndexAt,
  shiftStart,
  upcomingShifts,
  zonedTimeToUtc,
} from "./oncall-schedule";

const iso = (value: string) => Date.parse(value);
const NY = "America/New_York";

function rotation(overrides: Partial<RotationConfig> = {}): RotationConfig {
  const base = {
    memberIds: ["alice", "bob", "carol"],
    period: "daily" as const,
    handoffAt: "09:00",
    timezone: NY,
    startsAt: iso("2026-03-06T14:00:00.000Z"),
  };
  return { ...base, ...overrides };
}

describe("zoned wall-clock conversion", () => {
  it("validates IANA zones", () => {
    expect(isValidTimeZone(NY)).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });

  it("moves a skipped spring-forward time later and picks the earlier ambiguous time", () => {
    expect(zonedTimeToUtc({ year: 2026, month: 3, day: 8 }, "02:30", NY)).toBe(
      iso("2026-03-08T07:30:00.000Z"),
    );
    expect(zonedTimeToUtc({ year: 2026, month: 11, day: 1 }, "01:30", NY)).toBe(
      iso("2026-11-01T05:30:00.000Z"),
    );
  });
});

describe("daily rotation across DST", () => {
  it("keeps 09:00 local handoffs, making the transition-day shifts 23 and 25 hours", () => {
    const spring = rotation();
    expect(shiftStart(spring, 0)).toBe(iso("2026-03-06T14:00:00.000Z"));
    expect(shiftStart(spring, 1)).toBe(iso("2026-03-07T14:00:00.000Z"));
    expect(shiftStart(spring, 2)).toBe(iso("2026-03-08T13:00:00.000Z"));
    expect(shiftStart(spring, 2) - shiftStart(spring, 1)).toBe(23 * 3_600_000);

    const fall = rotation({ startsAt: iso("2026-10-31T13:00:00.000Z") });
    expect(shiftStart(fall, 1)).toBe(iso("2026-11-01T14:00:00.000Z"));
    expect(shiftStart(fall, 1) - shiftStart(fall, 0)).toBe(25 * 3_600_000);
  });

  it("finds the covering shift exactly at and around handoffs", () => {
    const value = rotation();
    expect(rotationIndexAt(value, iso("2026-03-06T13:59:59.000Z"))).toBe(-1);
    expect(rotationIndexAt(value, iso("2026-03-06T14:00:00.000Z"))).toBe(0);
    expect(rotationIndexAt(value, iso("2026-03-08T12:59:59.000Z"))).toBe(1);
    expect(rotationIndexAt(value, iso("2026-03-08T13:00:00.000Z"))).toBe(2);
    expect(rotationIndexAt(value, iso("2026-03-09T13:00:00.000Z"))).toBe(3);
  });

  it("lists the current shift first and cycles members in order", () => {
    const shifts = upcomingShifts(rotation(), [], iso("2026-03-07T20:00:00.000Z"), 5);
    expect(shifts.map((shift) => shift.userId)).toEqual(["bob", "carol", "alice", "bob", "carol"]);
    expect(shifts[0]).toEqual({
      userId: "bob",
      startsAt: iso("2026-03-07T14:00:00.000Z"),
      endsAt: iso("2026-03-08T13:00:00.000Z"),
      override: false,
    });
    for (let index = 1; index < shifts.length; index += 1) {
      expect(shifts[index]?.startsAt).toBe(shifts[index - 1]?.endsAt);
    }
  });

  it("has no current shift before the first handoff but lists the first one", () => {
    const value = rotation();
    expect(currentShift(value, [], iso("2026-03-01T00:00:00.000Z"))).toBeNull();
    const [first] = upcomingShifts(value, [], iso("2026-03-01T00:00:00.000Z"), 1);
    expect(first?.userId).toBe("alice");
    expect(first?.startsAt).toBe(value.startsAt);
  });
});

describe("weekly rotation", () => {
  it("hands off every seven local days, including across DST", () => {
    const value = rotation({
      period: "weekly",
      memberIds: ["alice", "bob"],
      startsAt: iso("2026-03-02T14:00:00.000Z"),
    });
    expect(shiftStart(value, 1)).toBe(iso("2026-03-09T13:00:00.000Z"));
    expect(currentShift(value, [], iso("2026-03-10T00:00:00.000Z"))?.userId).toBe("bob");
    expect(currentShift(value, [], iso("2026-03-17T00:00:00.000Z"))?.userId).toBe("alice");
  });
});

describe("overrides", () => {
  const value = rotation();
  const cover = {
    userId: "dave",
    startsAt: iso("2026-03-07T18:00:00.000Z"),
    endsAt: iso("2026-03-07T22:00:00.000Z"),
  };

  it("replace the rotation for their window and split the surrounding shift", () => {
    expect(currentShift(value, [cover], iso("2026-03-07T19:00:00.000Z"))).toEqual({
      ...cover,
      override: true,
    });
    const shifts = upcomingShifts(value, [cover], iso("2026-03-07T15:00:00.000Z"), 4);
    expect(shifts).toEqual([
      {
        userId: "bob",
        startsAt: iso("2026-03-07T14:00:00.000Z"),
        endsAt: cover.startsAt,
        override: false,
      },
      { ...cover, override: true },
      {
        userId: "bob",
        startsAt: cover.endsAt,
        endsAt: iso("2026-03-08T13:00:00.000Z"),
        override: false,
      },
      {
        userId: "carol",
        startsAt: iso("2026-03-08T13:00:00.000Z"),
        endsAt: iso("2026-03-09T13:00:00.000Z"),
        override: false,
      },
    ]);
  });

  it("reports the resumed rotation shift as starting when the override ended", () => {
    const current = currentShift(value, [cover], iso("2026-03-07T23:00:00.000Z"));
    expect(current).toMatchObject({ userId: "bob", startsAt: cover.endsAt, override: false });
  });

  it("cover someone before the rotation starts", () => {
    const early = {
      userId: "dave",
      startsAt: iso("2026-03-01T00:00:00.000Z"),
      endsAt: value.startsAt,
    };
    expect(currentShift(value, [early], iso("2026-03-02T00:00:00.000Z"))?.userId).toBe("dave");
  });
});

describe("overlapping overrides", () => {
  const value = rotation();
  const long = {
    id: "ovr_long",
    userId: "dave",
    startsAt: iso("2026-03-07T16:00:00.000Z"),
    endsAt: iso("2026-03-08T00:00:00.000Z"),
    createdAt: 1,
  };
  const nested = {
    id: "ovr_nested",
    userId: "erin",
    startsAt: iso("2026-03-07T18:00:00.000Z"),
    endsAt: iso("2026-03-07T20:00:00.000Z"),
    createdAt: 0,
  };
  const orders = <T>(items: T[]): T[][] => [items, [...items].reverse()];

  it("lets the later start win, then resumes the earlier override", () => {
    for (const overrides of orders([long, nested])) {
      expect(activeOverride(overrides, iso("2026-03-07T19:00:00.000Z"))?.id).toBe("ovr_nested");
      expect(activeOverride(overrides, iso("2026-03-07T21:00:00.000Z"))?.id).toBe("ovr_long");
      expect(
        upcomingShifts(value, overrides, iso("2026-03-07T17:00:00.000Z"), 4).map((shift) => [
          shift.userId,
          shift.startsAt,
          shift.endsAt,
        ]),
      ).toEqual([
        ["dave", long.startsAt, nested.startsAt],
        ["erin", nested.startsAt, nested.endsAt],
        ["dave", nested.endsAt, long.endsAt],
        ["bob", long.endsAt, iso("2026-03-08T13:00:00.000Z")],
      ]);
    }
  });

  it("breaks equal starts by the newest override, then by id, whatever the input order", () => {
    const at = iso("2026-03-07T17:00:00.000Z");
    const newer = { ...long, id: "ovr_a", userId: "erin", createdAt: 2 };
    for (const overrides of orders([long, newer])) {
      expect(activeOverride(overrides, at)?.id).toBe("ovr_a");
    }
    const twin = { ...long, id: "ovr_z", userId: "erin" };
    for (const overrides of orders([long, twin])) {
      expect(activeOverride(overrides, at)?.id).toBe("ovr_z");
    }
  });
});

describe("onCallThroughout", () => {
  const value = rotation();
  const bobStart = iso("2026-03-07T14:00:00.000Z");
  const bobEnd = iso("2026-03-08T13:00:00.000Z");

  it("accepts windows inside the person's shifts, including ones an override gave them", () => {
    expect(onCallThroughout(value, [], "bob", bobStart, bobEnd)).toBe(true);
    expect(onCallThroughout(value, [], "bob", bobStart + 3_600_000, bobEnd - 3_600_000)).toBe(true);
    const toDave = { userId: "dave", startsAt: bobStart, endsAt: bobEnd };
    expect(onCallThroughout(value, [toDave], "dave", bobStart, bobEnd)).toBe(true);
    expect(onCallThroughout(value, [toDave], "bob", bobStart, bobStart + 60_000)).toBe(false);
    const solo = rotation({ memberIds: ["bob"] });
    expect(onCallThroughout(solo, [], "bob", bobStart, bobStart + 5 * 86_400_000)).toBe(true);
  });

  it("rejects windows that reach into someone else's time", () => {
    expect(onCallThroughout(value, [], "bob", bobStart - 60_000, bobEnd)).toBe(false);
    expect(onCallThroughout(value, [], "bob", bobStart, bobEnd + 60_000)).toBe(false);
    expect(onCallThroughout(value, [], "carol", bobStart, bobStart + 60_000)).toBe(false);
    const cover = { userId: "dave", startsAt: bobStart + 3_600_000, endsAt: bobStart + 7_200_000 };
    expect(onCallThroughout(value, [cover], "bob", bobStart, bobEnd)).toBe(false);
    const early = rotation({ startsAt: bobEnd });
    expect(onCallThroughout(early, [], "alice", bobStart, bobEnd + 60_000)).toBe(false);
  });
});

describe("rotation start and escalation order", () => {
  it("defaults to the latest handoff at or before now", () => {
    expect(normalizeRotationStart("09:00", NY, undefined, iso("2026-03-07T13:00:00.000Z"))).toBe(
      iso("2026-03-06T14:00:00.000Z"),
    );
    expect(normalizeRotationStart("09:00", NY, undefined, iso("2026-03-07T14:00:00.000Z"))).toBe(
      iso("2026-03-07T14:00:00.000Z"),
    );
    expect(normalizeRotationStart("09:00", NY, iso("2026-03-10T03:00:00.000Z"), 0)).toBe(
      iso("2026-03-09T13:00:00.000Z"),
    );
  });

  it("pages the next unnotified rotation member", () => {
    const value = rotation();
    const at = iso("2026-03-07T20:00:00.000Z");
    expect(nextInRotation(value, "bob", new Set(["bob"]), at)).toBe("carol");
    expect(nextInRotation(value, "carol", new Set(["bob", "carol"]), at)).toBe("alice");
    expect(nextInRotation(value, "dave", new Set(["dave"]), at)).toBe("bob");
    expect(nextInRotation(value, "alice", new Set(["alice", "bob", "carol"]), at)).toBeNull();
  });
});
