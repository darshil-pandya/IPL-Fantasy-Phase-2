/**
 * Offline waiver timeline (IST wall times → UTC ISO for `at`).
 * Player ids must match `franchises.json` / `players.json` / `waiver-pool.json`.
 *
 * effectiveAfterMatchIndex: 0-based index into matches sorted by `matchDate` ascending
 * from `iplFantasy/fantasyMatchScores` (must match Admin score sync order).
 * "After match 4" => index 3 (fourth match).
 */

export type TransferRow = {
  owner: string;
  playerInId: string;
  playerOutId: string;
  amountInr: number;
  /** ISO-8601 UTC — human event time */
  atUtc: string;
  /** See module doc */
  effectiveAfterMatchIndex: number;
};

/** Single owner may have multiple rows in one batch; apply in array order. */
export const APRIL_2026_BACKFILL_TRANSFERS: TransferRow[] = [
  // 1 Apr 7 PM IST → 2026-04-01T13:30:00.000Z; after match index 3 (4th match)
  {
    owner: "Hersh",
    playerInId: "mitchell-santner",
    playerOutId: "sai-kishore",
    amountInr: 10_000,
    atUtc: "2026-04-01T13:30:00.000Z",
    effectiveAfterMatchIndex: 3,
  },
  {
    owner: "Bhavya",
    playerInId: "jacob-duffy",
    playerOutId: "zeeshan-ansari",
    amountInr: 40_000,
    atUtc: "2026-04-01T13:30:00.000Z",
    effectiveAfterMatchIndex: 3,
  },
  {
    owner: "Bhavya",
    playerInId: "nandre-burger",
    playerOutId: "tushar-deshpande",
    amountInr: 40_000,
    atUtc: "2026-04-01T13:30:00.000Z",
    effectiveAfterMatchIndex: 3,
  },
  {
    owner: "Hersh",
    playerInId: "cooper-connolly",
    playerOutId: "jacob-bethell",
    amountInr: 100_000,
    atUtc: "2026-04-01T13:30:00.000Z",
    effectiveAfterMatchIndex: 3,
  },

  // 2 Apr 7 PM IST — after match index 4
  {
    owner: "Jash",
    playerInId: "lungi-ngidi",
    playerOutId: "matheesha-pathirana",
    amountInr: 50_000,
    atUtc: "2026-04-02T13:30:00.000Z",
    effectiveAfterMatchIndex: 4,
  },
  {
    owner: "Jash",
    playerInId: "ayush-badoni",
    playerOutId: "josh-inglis",
    amountInr: 50_000,
    atUtc: "2026-04-02T13:30:00.000Z",
    effectiveAfterMatchIndex: 4,
  },
  {
    owner: "Prajin",
    playerInId: "mohsin-khan",
    playerOutId: "deepak-chahar",
    amountInr: 20_000,
    atUtc: "2026-04-02T13:30:00.000Z",
    effectiveAfterMatchIndex: 4,
  },
  {
    owner: "Karan",
    playerInId: "t-natarajan",
    playerOutId: "azmatullah-omarzai",
    amountInr: 20_000,
    atUtc: "2026-04-02T13:30:00.000Z",
    effectiveAfterMatchIndex: 4,
  },
  {
    owner: "Karan",
    playerInId: "vijaykumar-vyshak",
    playerOutId: "rahul-tewatia",
    amountInr: 15_000,
    atUtc: "2026-04-02T13:30:00.000Z",
    effectiveAfterMatchIndex: 4,
  },
  {
    owner: "Karan",
    playerInId: "sameer-rizvi",
    playerOutId: "wanindu-hasaranga",
    amountInr: 10_000,
    atUtc: "2026-04-02T13:30:00.000Z",
    effectiveAfterMatchIndex: 4,
  },
  {
    owner: "Jash",
    playerInId: "aniket-verma",
    playerOutId: "tim-seifert",
    amountInr: 50_000,
    atUtc: "2026-04-02T13:30:00.000Z",
    effectiveAfterMatchIndex: 4,
  },

  // 3 Apr 7 PM IST — after match index 5
  {
    owner: "Darshil",
    playerInId: "blessing-muzarabani",
    playerOutId: "vipraj-nigam",
    amountInr: 20_000,
    atUtc: "2026-04-03T13:30:00.000Z",
    effectiveAfterMatchIndex: 5,
  },
  {
    owner: "Karan",
    playerInId: "jamie-overton",
    playerOutId: "liam-livingstone",
    amountInr: 15_000,
    atUtc: "2026-04-03T13:30:00.000Z",
    effectiveAfterMatchIndex: 5,
  },
  {
    owner: "Darshil",
    playerInId: "xavier-bartlett",
    playerOutId: "rachin-ravindra",
    amountInr: 30_000,
    atUtc: "2026-04-03T13:30:00.000Z",
    effectiveAfterMatchIndex: 5,
  },
  {
    owner: "Darshil",
    playerInId: "anshul-kamboj",
    playerOutId: "quinton-de-kock",
    amountInr: 30_000,
    atUtc: "2026-04-03T13:30:00.000Z",
    effectiveAfterMatchIndex: 5,
  },

  // 4 Apr 1 PM IST — after match index 6
  {
    owner: "Sanket",
    playerInId: "jaydev-unadkat",
    playerOutId: "harshal-patel",
    amountInr: 20_000,
    atUtc: "2026-04-04T07:30:00.000Z",
    effectiveAfterMatchIndex: 6,
  },
  {
    owner: "Hersh",
    playerInId: "brijesh-sharma",
    playerOutId: "avesh-kumar",
    amountInr: 10_000,
    atUtc: "2026-04-04T07:30:00.000Z",
    effectiveAfterMatchIndex: 6,
  },
  {
    owner: "Karan",
    playerInId: "donovan-ferreira",
    playerOutId: "digvesh-rathi",
    amountInr: 5000,
    atUtc: "2026-04-04T07:30:00.000Z",
    effectiveAfterMatchIndex: 6,
  },

  // 5 Apr 1 PM IST — after match index 8 (9th match)
  {
    owner: "Hersh",
    playerInId: "tim-david",
    playerOutId: "abhishek-porel",
    amountInr: 5000,
    atUtc: "2026-04-05T07:30:00.000Z",
    effectiveAfterMatchIndex: 8,
  },
  {
    owner: "Hersh",
    playerInId: "prince-yadav",
    playerOutId: "jason-holder",
    amountInr: 10_000,
    atUtc: "2026-04-05T07:30:00.000Z",
    effectiveAfterMatchIndex: 8,
  },
];
