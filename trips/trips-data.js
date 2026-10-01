/* Trip content: regions, transport modes, the 15 days and the extras, plus mode icons. Classic script; its top-level consts are shared with trips.js. */
const REGIONS = {
  island:  { name: "Hong Kong Island", short: "Island", color: "var(--island)" },
  kowloon: { name: "Kowloon", short: "Kowloon", color: "var(--kowloon)" },
  nt:      { name: "New Territories", short: "New Territories", color: "var(--nt)" },
  isles:   { name: "Lantau and the islands", short: "Lantau and islands", color: "var(--isles)" }
};

const MODES = {
  walk: "Walk", tram: "Tram", mtr: "MTR", lrt: "Light Rail", bus: "Bus", mini: "Minibus",
  ferry: "Ferry", cable: "Cable car", taxi: "Taxi", hike: "Hike", sight: "Stop", food: "Eat", peak: "Peak Tram"
};

const DAYS = [
  {
    n: 1, r: "island", zh: "中上環、山頂", en: "Central, Sheung Wan and the Peak",
    tags: "History, culture", when: "Wed, Fri or a weekend",
    whenNote: "Flagstaff House and the Dr Sun Yat-sen Museum each close one weekday (Tuesday and Thursday, I believe). A Wednesday, Friday or weekend should avoid both.",
    steps: [
      { m: "tram", t: "Tram west from the Happy Valley terminus to Admiralty." },
      { m: "walk", t: "Through Hong Kong Park to the Peak Tram on Garden Road. Go early; queues build fast." },
      { m: "peak", t: "Peak Tram up." },
      { m: "walk", t: "Lugard Road loop, about an hour on the flat, with the classic harbour view." },
      { m: "peak", t: "Peak Tram down." },
      { m: "sight", t: "Flagstaff House Museum of Tea Ware in Hong Kong Park, the oldest colonial building still standing.", c: "Closed Tuesdays, I believe." },
      { m: "walk", t: "Tai Kwun: the former Central Police Station, magistracy and Victoria Prison." },
      { m: "walk", t: "Up the Central–Mid-Levels escalator to the Dr Sun Yat-sen Museum.", c: "Closed Thursdays, I believe." },
      { m: "walk", t: "Back down through PMQ, Pottinger Street and Graham Street market." },
      { m: "sight", t: "Hollywood Road, Man Mo Temple and the Cat Street stalls." },
      { m: "walk", t: "Possession Street, where the British flag first went up in 1841, then the dried-seafood shops on Des Voeux Road West." },
      { m: "tram", t: "Tram home from Sheung Wan." }
    ],
    notes: ["Almost the whole day is on foot, within a couple of kilometres."]
  },
  {
    n: 2, r: "island", zh: "黃泥涌峽、大潭、赤柱", en: "WWII trails and Stanley",
    tags: "History, hiking",
    steps: [
      { m: "taxi", t: "Up to Wong Nai Chung Gap, straight uphill from Happy Valley. A taxi is a short ride.", c: "A bus or minibus from your door may work; I'm not sure which is best, so see the app." },
      { m: "hike", t: "Wong Nai Chung Gap Trail, across the 1941 battlefield: pillboxes and signboards." },
      { m: "hike", t: "Tai Tam Waterworks Heritage Trail: Victorian dams, bridges and valve houses, ending at Tai Tam Road." },
      { m: "bus", t: "Bus along Tai Tam Road to Stanley.", c: "Route 14, I believe." },
      { m: "sight", t: "Stanley Military Cemetery, Murray House, the Tin Hau temple and the market." },
      { m: "bus", t: "Bus back to Central or Causeway Bay, then home.", c: "I haven't confirmed which route suits best." }
    ],
    alts: [
      {
        h: "Variant: Po Toi instead of the trails",
        t: "Ferries leave Stanley's Blake Pier at 10:30 on Tuesdays, Thursdays and Saturdays, and at 10:00, 11:30, 15:30 and 17:00 on Sundays and public holidays. Coming back: 15:30 on Tuesdays and Thursdays; 12:40 to Stanley or 14:00 and 16:00 via Stanley on Saturdays; 15:00 and 16:30 to Stanley or 18:00 via Stanley on Sundays. HK$30 each way for visitors. The Friday service ran only until 31 May 2026. Spend the late afternoon in Stanley."
      }
    ]
  },
  {
    n: 3, r: "island", zh: "龍脊、筲箕灣", en: "Dragon's Back and coastal defence",
    tags: "Hiking, history",
    steps: [
      { m: "mtr", t: "Walk to Causeway Bay, then the Island Line to Shau Kei Wan." },
      { m: "bus", t: "Bus 9 from the bus terminus to the To Tei Wan trailhead." },
      { m: "hike", t: "Along the Dragon's Back ridge and down to Big Wave Bay. Start early; midday is hot in October." },
      { m: "food", t: "Lunch in Shek O." },
      { m: "bus", t: "Bus 9 back to Shau Kei Wan." },
      { m: "walk", t: "About 15 minutes to the Museum of Coastal Defence, a Victorian fort over Lei Yue Mun.", c: "I believe it has reopened; I don't know its closing day." },
      { m: "tram", t: "Tram home, stopping at Quarry Bay for the Monster Building at dusk. People live there, so keep quiet and don't block entrances." }
    ],
    notes: ["Optional: Law Uk Folk Museum, a restored Hakka house, is by Chai Wan station, two stops past Shau Kei Wan."]
  },
  {
    n: 4, r: "kowloon", zh: "尖沙咀、西九龍", en: "Tsim Sha Tsui and West Kowloon",
    tags: "History, culture", when: "Wednesday to Sunday",
    whenNote: "The Palace Museum closes on Tuesdays (except public holidays); M+ closes Mondays and the Museum of History Tuesdays, I believe.",
    steps: [
      { m: "bus", t: "Bus to Exhibition Centre." },
      { m: "mtr", t: "East Rail one stop, under the harbour, to Hung Hom." },
      { m: "walk", t: "Walk to the Museum of History. Its rebuilt permanent exhibition, the Hong Kong Story, reopened on 1 April 2026; entry is free.", c: "Closed Tuesdays, I believe." },
      { m: "mtr", t: "Tuen Ma Line from East Tsim Sha Tsui to Austin." },
      { m: "sight", t: "Hong Kong Palace Museum, then M+ and its free roof garden.", c: "M+ closed Mondays, I believe." },
      { m: "sight", t: "Xiqu Centre, if there's an evening Cantonese opera show." },
      { m: "walk", t: "Along the harbourfront to the Tsim Sha Tsui promenade for the Symphony of Lights.", c: "8pm, I believe." },
      { m: "ferry", t: "Star Ferry to Wan Chai, then home." }
    ],
    notes: ["Alternative evening: a harbour cruise on a red-sailed junk instead of the light show from the promenade."]
  },
  {
    n: 5, r: "kowloon", zh: "黃大仙、九龍城", en: "Temples and old Kowloon City",
    tags: "Culture, history",
    steps: [
      { m: "bus", t: "Bus to Exhibition Centre." },
      { m: "mtr", t: "East Rail to Kowloon Tong, then the Kwun Tong Line two stops to Wong Tai Sin." },
      { m: "sight", t: "Wong Tai Sin Temple, best in the morning: fortune sticks and the fortune tellers' arcade." },
      { m: "mtr", t: "One stop to Diamond Hill: Chi Lin Nunnery, built without nails, and Nan Lian Garden. Both free." },
      { m: "mtr", t: "Tuen Ma Line to Kai Tak: the Sports Park, and the Lung Tsun Stone Bridge preservation corridor.", c: "I'm not sure of the corridor's visitor access." },
      { m: "mtr", t: "One stop to Sung Wong Toi: the rock tied to the last Song emperor, the same story as Chiwan in Shenzhen." },
      { m: "walk", t: "Kowloon Walled City Park, with the old yamen (Qing magistrate's office) still standing.", c: "About 15 minutes' walk, I think." },
      { m: "food", t: "Dinner at one of Kowloon City's Thai restaurants." },
      { m: "mtr", t: "Tuen Ma Line to Hung Hom, East Rail to Exhibition Centre, bus home." }
    ],
    notes: ["Optional: Choi Hung Estate's painted blocks are one stop from Diamond Hill on the Kwun Tong Line."]
  },
  {
    n: 6, r: "kowloon", zh: "深水埗、旺角", en: "Sham Shui Po and the Mong Kok markets",
    tags: "Culture, history", when: "Finish after dark",
    steps: [
      { m: "walk", t: "Walk to Causeway Bay." },
      { m: "mtr", t: "Island Line to Admiralty, then the Tsuen Wan Line to Lai Chi Kok: Jao Tsung-I Academy, a former quarantine station on a hillside." },
      { m: "mtr", t: "Cheung Sha Wan: Lei Cheng Uk Han Tomb, about 2,000 years old." },
      { m: "mtr", t: "Sham Shui Po: Mei Ho House, Apliu Street, Ki Lung Street's fabric shops." },
      { m: "food", t: "A noodle-shop or dai pai dong (licensed open-air food stall) lunch." },
      { m: "mtr", t: "Prince Edward: Flower Market, Yuen Po Street Bird Garden, Goldfish Market." },
      { m: "walk", t: "South through Mong Kok to Yau Ma Tei for the Temple Street night market after dark." },
      { m: "mtr", t: "Jordan, Tsuen Wan Line to Admiralty, Island Line to Causeway Bay, walk home." }
    ],
    notes: ["This runs one way along a single line, so there's no doubling back.", "The Yau Ma Tei fruit market is an early-morning thing and doesn't fit this day."]
  },
  {
    n: 7, r: "nt", zh: "屏山、錦田", en: "Yuen Long clan villages",
    tags: "History", when: "Avoid Tuesday",
    whenNote: "The Wetland Park closes on Tuesdays, I believe.",
    steps: [
      { m: "bus", t: "Bus to Exhibition Centre." },
      { m: "mtr", t: "East Rail to Hung Hom, then the Tuen Ma Line to Tin Shui Wai, roughly an hour." },
      { m: "lrt", t: "Light Rail to Hong Kong Wetland Park." },
      { m: "lrt", t: "Back to Tin Shui Wai." },
      { m: "hike", t: "Ping Shan Heritage Trail, starting at the Tsui Sing Lau pagoda beside the station: Tang clan ancestral halls, a study hall and a walled village." },
      { m: "mtr", t: "Tuen Ma Line to Kam Sheung Road." },
      { m: "walk", t: "Kat Hing Wai, a walled village still lived in, with its moat and iron gates.", c: "15–20 minutes' walk, I think. There's usually a small donation box." },
      { m: "mtr", t: "Tuen Ma Line to Hung Hom, East Rail home." }
    ],
    notes: ["Mai Po Nature Reserve is nearby but needs a pre-booked WWF guided tour; migratory birds arrive from October."]
  },
  {
    n: 8, r: "nt", zh: "大埔、粉嶺、新田", en: "North District heritage",
    tags: "History",
    steps: [
      { m: "bus", t: "Bus to Exhibition Centre." },
      { m: "mtr", t: "East Rail to Tai Po Market: the Hong Kong Railway Museum, old station building and carriages." },
      { m: "mtr", t: "East Rail to Fanling." },
      { m: "mini", t: "Lung Yeuk Tau Heritage Trail: five walled villages and five open ones.", c: "A minibus or a longish walk from the station; route not confirmed." },
      { m: "mtr", t: "East Rail to Sheung Shui." },
      { m: "bus", t: "Bus to San Tin for Tai Fu Tai Mansion, a scholar-gentry house from 1865.", c: "Bus route and opening days not confirmed." },
      { m: "mtr", t: "Back to Sheung Shui, East Rail home." }
    ],
    notes: ["Optional on the way home: change at Tai Wai for the Tuen Ma Line to reach Tsang Tai Uk, a Hakka walled compound (nearest station Sha Tin Wai, I believe). People still live there, so keep your voice down."]
  },
  {
    n: 9, r: "nt", zh: "荃灣、城門", en: "Tsuen Wan and Shing Mun",
    tags: "History, hiking",
    steps: [
      { m: "walk", t: "Walk to Causeway Bay." },
      { m: "mtr", t: "Island Line to Admiralty, then the Tsuen Wan Line to the end." },
      { m: "walk", t: "Sam Tung Uk Museum, a restored Hakka walled house, a short walk away." },
      { m: "mini", t: "Green minibus to Shing Mun Reservoir.", c: "Route 82, I believe." },
      { m: "hike", t: "Shing Mun Redoubt: WWII tunnels and trenches on the Gin Drinkers Line." },
      { m: "mini", t: "Minibus back to Tsuen Wan, then the Tsuen Wan Line home." }
    ],
    alts: [
      { h: "Harder alternative: Tai Mo Shan", t: "Hong Kong's highest peak, a separate day from Tsuen Wan.", c: "Bus 51, I believe." },
      { h: "Add-on: Ma Wan", t: "Tsing Ma Bridge views and an old fishing village emptied for redevelopment.", c: "By ferry or bus from Tsuen Wan; current service not checked." }
    ]
  },
  {
    n: 10, r: "nt", zh: "彩虹、西貢", en: "Sai Kung, the easy version",
    tags: "Islands, novelty", when: "Low tide for the sandbar",
    whenNote: "The Kiu Tsui sandbar is only walkable at low tide. Check the Observatory's tide table.",
    steps: [
      { m: "bus", t: "Bus to Exhibition Centre." },
      { m: "mtr", t: "East Rail to Kowloon Tong, then the Kwun Tong Line to Choi Hung. The painted estate is right by the station." },
      { m: "mini", t: "Green minibus 1A to Sai Kung town.", c: "About half an hour, I believe." },
      { m: "ferry", t: "Kaito (small ferry) from Sai Kung pier to Yim Tin Tsai, an abandoned Hakka salt-making village with a restored chapel, and/or Kiu Tsui's sandbar." },
      { m: "food", t: "Seafood dinner on the Sai Kung waterfront." },
      { m: "mini", t: "Minibus 1A back to Choi Hung, then the same trains home." }
    ]
  },
  {
    n: 11, r: "nt", zh: "萬宜、蚺蛇尖", en: "Sai Kung, the hard version",
    tags: "Hiking", when: "Dry weather only",
    whenNote: "Sharp Peak's path is steep and loose; don't attempt it after rain.",
    steps: [
      { m: "mtr", t: "Same start as day 10: Exhibition Centre, East Rail, Kwun Tong Line to Choi Hung, minibus to Sai Kung town." },
      { m: "bus", t: "Onward by bus, minibus or taxi.", c: "The last leg is thin and partly weekend-only, and I'm not confident of the routes. Plan it entirely in the app." },
      { m: "hike", t: "Either the High Island Reservoir East Dam: hexagonal volcanic columns in the UNESCO Global Geopark." },
      { m: "hike", t: "Or Sharp Peak and the four beaches of Tai Long Wan, which have no road access." }
    ]
  },
  {
    n: 12, r: "nt", zh: "荔枝窩、塔門、東平洲", en: "The northeast by ferry",
    tags: "Islands, history", when: "Weekend for Lai Chi Wo",
    steps: [
      { m: "bus", t: "Bus to Exhibition Centre." },
      { m: "mtr", t: "East Rail to University." },
      { m: "walk", t: "About 10–15 minutes to Ma Liu Shui pier." },
      { m: "ferry", t: "Pick one of the three boats below. Each is a full day." }
    ],
    alts: [
      {
        h: "Lai Chi Wo",
        t: "A 300-year-old Hakka walled village. The ferry leaves at 9:00 on Saturdays, Sundays and public holidays, takes about 90 minutes and costs HK$45 each way. On weekdays it sails only on demand.",
        c: "The return time was cut off when I checked; it's mid-afternoon. Confirm before you go. Kat O and Ap Chau are usually reached by tour boat."
      },
      {
        h: "Tap Mun",
        t: "Grassy headland and a Tin Hau temple, and it works on weekdays. Out at 08:30 or 15:00; back from Tap Mun at 11:10 or 17:30. Holidays add a 12:30 out and a 13:45 back. HK$20 on weekdays, HK$30 on holidays.",
        c: "From a boat operator's page updated April 2026."
      },
      {
        h: "Tung Ping Chau",
        t: "A flat crescent island near Shenzhen with layered rock shelves.",
        c: "A weekend ferry from Ma Liu Shui, I believe."
      }
    ]
  },
  {
    n: 13, r: "isles", zh: "昂坪、大澳", en: "Lantau: Big Buddha and Tai O",
    tags: "Culture, hiking",
    steps: [
      { m: "walk", t: "Walk to Causeway Bay." },
      { m: "mtr", t: "Island Line to Central, then walk to Hong Kong station." },
      { m: "mtr", t: "Tung Chung Line to Tung Chung." },
      { m: "cable", t: "Ngong Ping 360 cable car, or bus 23 for less." },
      { m: "sight", t: "Big Buddha, Po Lin Monastery and the Wisdom Path's wooden steles." },
      { m: "bus", t: "Bus to Tai O.", c: "Route 21, I believe." },
      { m: "food", t: "Tai O's stilt houses over the water, shrimp paste, and dinner." },
      { m: "bus", t: "Bus back to Tung Chung, then the same trains home.", c: "Route 11, I believe." }
    ],
    alts: [
      { h: "Hiking variant", t: "Bus from Tung Chung to Pak Kung Au, climb Lantau Peak, and come down at Ngong Ping. Hard: 3–4 hours." }
    ]
  },
  {
    n: 14, r: "isles", zh: "南丫島、香港仔", en: "Lamma and Aberdeen",
    tags: "Islands, hiking",
    steps: [
      { m: "tram", t: "Tram to Central, then walk to the Central Piers." },
      { m: "ferry", t: "Pier 4 ferry to Yung Shue Wan." },
      { m: "hike", t: "The Family Trail walk across the island to Sok Kwu Wan." },
      { m: "food", t: "Seafood lunch at Sok Kwu Wan." },
      { m: "ferry", t: "Ferry from Sok Kwu Wan to Aberdeen.", c: "Sailings are infrequent; check the timetable." },
      { m: "ferry", t: "Sampan ride through the Aberdeen typhoon shelter." },
      { m: "bus", t: "Bus home through the Aberdeen Tunnel, which comes out right by Happy Valley.", c: "I haven't confirmed which route stops closest." }
    ]
  },
  {
    n: 15, r: "isles", zh: "長洲", en: "Cheung Chau",
    tags: "Islands, culture",
    steps: [
      { m: "tram", t: "Tram to Central, then walk to the Central Piers." },
      { m: "ferry", t: "Pier 5 ferry to Cheung Chau." },
      { m: "sight", t: "Pak Tai Temple." },
      { m: "hike", t: "South along the island to Cheung Po Tsai Cave, the pirate's hideout." },
      { m: "food", t: "Fish balls, and whatever else is frying on the waterfront." },
      { m: "ferry", t: "Ferry back to Central, then tram home." }
    ],
    notes: ["Peng Chau, from Pier 6, makes a short half-day on its own."]
  }
];

const EXTRAS = [
  { h: "Happy Valley races", t: "On your doorstep on Wednesday nights in season: cheap entry and the skyline around the track.", c: "Season runs roughly September to July, I believe; check the Jockey Club fixtures." },
  { h: "Ding Ding and the Star Ferry", t: "The tram end to end from your own stop, upstairs at the front, then the Star Ferry across. An easy evening." },
  { h: "Ocean Park", t: "Walk to Causeway Bay, Island Line to Admiralty, South Island Line to Ocean Park station. A full day." },
  { h: "Disneyland", t: "Island Line to Central, walk to Hong Kong station, Tung Chung Line to Sunny Bay, then the Disneyland Resort Line. A full day." }
];

/* ======================================================================
   Icons (24px, stroked)
   ====================================================================== */
const ICONS = {
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M9.5 21l2.2-6.2 2.8 2.7V21"/><path d="M7.5 12.5l2.3-4.2 4 .8 2.4 3.2"/><path d="M11.7 14.8l-1.9-6.5"/>',
  tram: '<rect x="5" y="7" width="14" height="11" rx="2"/><path d="M9 7l3-3.5L15 7M5 11.5h14M8.5 20.5l1-2.5M15.5 20.5l-1-2.5"/>',
  peak: '<path d="M3 20L21 6"/><rect x="7" y="9" width="9" height="7" rx="1.5" transform="rotate(-38 11.5 12.5)"/>',
  mtr: '<rect x="6" y="3" width="12" height="14" rx="3.5"/><path d="M6 10h12M9 13.5h.01M15 13.5h.01M8.5 21l2-4M15.5 21l-2-4"/>',
  lrt: '<rect x="4" y="6" width="16" height="11" rx="2.5"/><path d="M4 11h16M12 6V3.5M9 3.5h6M8 20l1.5-3M16 20l-1.5-3"/>',
  bus: '<rect x="4" y="3.5" width="16" height="14" rx="2.5"/><path d="M4 10.5h16M7.5 14h.01M16.5 14h.01M7 17.5v2.5M17 17.5v2.5"/>',
  mini: '<path d="M3 16.5V10a3 3 0 0 1 3-3h9.5l5 5v4.5z"/><path d="M3 12h17.5M15 7v5"/><circle cx="7.5" cy="17.5" r="1.6"/><circle cx="16.5" cy="17.5" r="1.6"/>',
  ferry: '<path d="M2.5 15h19l-2.5 4.5H5z"/><path d="M6 15v-4h12v4M9.5 11V8h5v3"/><path d="M2 21.5c1.5 0 1.5-.8 3-.8s1.5.8 3 .8 1.5-.8 3-.8 1.5.8 3 .8 1.5-.8 3-.8 1.5.8 3 .8"/>',
  cable: '<path d="M3 5.5L21 2.5M12 4v3.5"/><rect x="6.5" y="7.5" width="11" height="10" rx="2.5"/><path d="M6.5 12h11"/>',
  taxi: '<path d="M4 16.5v-4l2.2-4.5h11.6l2.2 4.5v4z"/><path d="M4 12.5h16M10 8V5.5h4V8"/><circle cx="7.5" cy="17" r="1.6"/><circle cx="16.5" cy="17" r="1.6"/>',
  hike: '<path d="M2.5 19.5l6.5-11 4 6 2.5-3.5 6 8.5z"/><path d="M9 8.5l1.2 2"/>',
  sight: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  food: '<path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0z"/><path d="M13 3l-2.5 7M18.5 4l-5.5 6"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`;

/* ======================================================================
   Rendering
   ====================================================================== */
