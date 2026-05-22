const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SIMPLE_HEADERS,
  mapLegacyOrdersValues,
  parseManualOrdersTextBlocks,
  parseManualOrdersTextDetailed,
} = require("../orders-helper.js");

const MESSY_SAMPLE = `20 мая Литвинов Андрей
- ментальный сжимающий комплекс который срабатывает на энергии страха 1,5 ед 25
высокочастотный психический блок - реакциясжатие - на заточение, тюрьма 1,5 ед 50
сверхвысокочастотный психический блок - Аджна 3 - есть люди с определенным кругом а я в ниего не вхожу (не достаточно хорош, не принадлежу, меня не принимают) дает сжатие 1 ед 50
Психический блок - отторжение контакта, телесно-сексуально с женщинами 35 лет и старше 3 ед 50

18 мая Литвинов Андрей
- идея что кто-то меня контролиует, например мама, поверяющий - комплекс реакция сопротивления на контроль 4 ед 25

комплексы состоящие из ментальных нитей,
- в районе носа 3.5 ед 25
/ переносица срабатывае ткомплекс из ментальных энергий
комплексы сжатия состоящие из ментальных энергий - они как вторичные комплексы - которые обслуживают различные сигналы комплексы
она завязана на десяток комлпексов - срабатывает как вторичная волна
- в районе груди 3 ед 25
- в районе паха 3 ед 25

15 мая литвинова Наталья
Регулировка серебристый канал ноющей боли в суставах и связках 2,5 ед 50

14 мая Литвинов Андрей - Программа обработки и компенсации страха военная 200

12.05 Литвинов Андрей - защитная программа, перерабатывающая негативные магические воздействия 1 уровня 500

10 мая Литвинов Андрей
1) реакция на важных людей (которые из себя что-то представляют) обычный комплекс напряжение типа стеснение 2 ед 25
2) низкочастотный комплекс 4 ед - что я менее ценен, меньше их (тех людей которые имеют какую-то значимость) 25
3) низкочастотный комплекс в районе неба - как ребенок прячется закрывается, сжимается 3 ед 25

4 мая литвинов андрей
1) реакция на ипостась - человек который несет некую власть надомной / в ее присустви - негатив 3,5 ед я ежусь 25
2) реакция на повышенный эмоциональный фон когда человек со мной говорит, толчки 2 ед
3) эмоциональный разговор с женщинами на повышенных тонах, женская истерика, толки 3 ед (напрягает. возмущает)
4) комплекс - реакция когда меня проверяют, факт - букет испуг пренебрежение 2.5 25
5) меня контролиует (на ресепшине, с кем я прихожу) - сработывает психический блок 1.5 50

3 мая
1. Литвинов Андрей
разовый стресс - негативное влияние на чужие советы вмешательство 12 ед 25

2. регулировка военная программа которая блокирует видение 3 ед 50`;

function rowsOnly(rows) {
  return rows.map((row) => row.slice());
}

function numberValue(value) {
  return Number(String(value || "").replace(",", "."));
}

function rowsWithTotal(rows) {
  const total = rows.reduce((sum, row) => sum + numberValue(row[5]), 0);
  return [...rows, ["", "", "ИТОГО", "", "", String(total)]];
}

test("parseManualOrdersTextBlocks splits numbered items inside one date-name block", () => {
  const rows = parseManualOrdersTextBlocks(
    [
      "14/04 Литвинов Андрей",
      "есть напряжение 6 ед в зоне между - небо - брови - центр головы.",
      "как столкновение полей",
      "давление по ментальным тела Вищудха 3",
      "вылив темного ментала - которы натыкается на мои тела 50",
      "",
      "21/05 Литвинов Андрей",
      "1) сжатие - на уровне живота - разовый стресс 6 ед - неудобство перед мужчиной который больше меня, сильнее меня /сжатие / неудобно себя чувствую / нияковость 25",
      "2) на уровне горла - испуг внезапный - с мужчиной которы йбольше меня, сильнее меня 8 ед 25",
      "",
      "литвинова наталья разовый стресс приближение собтсвенной смерти 20 ед",
    ].join("\n"),
    "2026-05-21"
  );

  assert.equal(rows.length, 3);
  assert.deepEqual(rowsOnly(rows), [
    [
      "14.04.2026",
      "Литвинов Андрей",
      "есть напряжение 6 ед в зоне между - небо - брови - центр головы. как столкновение полей давление по ментальным тела Вищудха 3 вылив темного ментала - которы натыкается на мои тела",
      "50",
      "50%",
      "25",
    ],
    [
      "21.05.2026",
      "Литвинов Андрей",
      "сжатие - на уровне живота - разовый стресс 6 ед - неудобство перед мужчиной который больше меня, сильнее меня /сжатие / неудобно себя чувствую / нияковость",
      "25",
      "50%",
      "12.5",
    ],
    [
      "21.05.2026",
      "Литвинов Андрей",
      "на уровне горла - испуг внезапный - с мужчиной которы йбольше меня, сильнее меня 8 ед",
      "25",
      "50%",
      "12.5",
    ],
  ]);
  assert.equal(rows.warnings.length, 1);
  assert.equal(rows.warnings[0].status, "missing_price");
});

test("mapLegacyOrdersValues collapses old wide sheet into normalized order columns", () => {
  const mapped = mapLegacyOrdersValues([
    ["NUMBER", "DATE", "CLIENT", "SERVICE", "COMMENT", "PRICE BASE", "ACCRUED +3%"],
    ["1", "21.04.2026", "Андрей", "Расчистка", "оплата 2 частями", "200", "206"],
  ]);

  assert.deepEqual(mapped.headers, SIMPLE_HEADERS);
  assert.deepEqual(mapped.rows[0], ["21.04.2026", "Андрей", "Расчистка | оплата 2 частями", "206", "50%", "103"]);
});

test("parseManualOrdersTextBlocks applies one header date and name to numbered items and warns on missing prices", () => {
  const rows = parseManualOrdersTextBlocks(
    [
      "04.03.2026 литвинов анд",
      "1) реакция на ипостась - человек который несет некую власть надо мной / в ее присутствии - негатив 3,5 ед я ежусь 25",
      "2) реакция на повышенный эмоциональный фон когда человек со мной говорит, толчки 2 ед",
      "3) эмоциональный разговор с женщинами на повышенных тонах, женская истерика, толчки 3 ед",
      "4) комплекс - реакция когда меня проверяют, факт - букет испуг пренебрежение 2.5 25",
      "5) меня контролирует (на ресепшине, с кем я прихожу) - срабатывает психический блок 1.5 50",
    ].join("\n"),
    "2026-05-05"
  );

  assert.deepEqual(rowsOnly(rows), [
    ["04.03.2026", "Литвинов Анд", "реакция на ипостась - человек который несет некую власть надо мной / в ее присутствии - негатив 3,5 ед я ежусь", "25", "50%", "12.5"],
    ["04.03.2026", "Литвинов Анд", "комплекс - реакция когда меня проверяют, факт - букет испуг пренебрежение 2.5", "25", "50%", "12.5"],
    ["04.03.2026", "Литвинов Анд", "меня контролирует (на ресепшине, с кем я прихожу) - срабатывает психический блок 1.5", "50", "50%", "25"],
  ]);
  assert.deepEqual(rows.warnings.map((warning) => warning.status), ["missing_price", "missing_price"]);
});

test("parseManualOrdersTextBlocks keeps numbered order words out of name without a header", () => {
  const rows = parseManualOrdersTextBlocks("1) реакция на повышенный эмоциональный фон 25", "2026-05-05");
  assert.deepEqual(rowsOnly(rows), [["", "", "реакция на повышенный эмоциональный фон", "25", "50%", "12.5"]]);
});

test("parseManualOrdersTextBlocks ignores decorative emoji divider lines", () => {
  const rows = parseManualOrdersTextBlocks(
    ["04.03.2026 литвинов анд", "[❤️] [❤️]", "1) заказ после декора 25"].join("\n"),
    "2026-05-05"
  );

  assert.deepEqual(rowsOnly(rows), [["04.03.2026", "Литвинов Анд", "заказ после декора", "25", "50%", "12.5"]]);
});

test("parseManualOrdersTextBlocks parses russian month headers with fallback year", () => {
  const rows = parseManualOrdersTextBlocks(["4 мая Литвин", "1) заказ с русским месяцем 25"].join("\n"), "2026-05-05");
  assert.deepEqual(rowsOnly(rows), [["04.05.2026", "Литвин", "заказ с русским месяцем", "25", "50%", "12.5"]]);
});

test("parseManualOrdersTextBlocks parses russian month headers with explicit year", () => {
  const rows = parseManualOrdersTextBlocks(["4 мая 2026 Литвин", "1) заказ с русским месяцем 50"].join("\n"), "2026-01-01");
  assert.deepEqual(rowsOnly(rows), [["04.05.2026", "Литвин", "заказ с русским месяцем", "50", "50%", "25"]]);
});

test("parseManualOrdersTextDetailed parses messy multi-date free text without zero-cost rows", () => {
  const result = parseManualOrdersTextDetailed(MESSY_SAMPLE, "2026-05-22");
  const rows = result.rows;
  const rowsAndTotal = rowsWithTotal(rows);
  const byDate = rows.reduce((counts, row) => {
    counts[row[0]] = (counts[row[0]] || 0) + 1;
    return counts;
  }, {});
  const row1405 = rows.find((row) => row[0] === "14.05.2026");
  const row1205 = rows.find((row) => row[0] === "12.05.2026");
  const rows0305 = rows.filter((row) => row[0] === "03.05.2026");

  assert.equal(rows.length, 19);
  assert.equal(rowsAndTotal.length, 20);
  assert.equal(byDate["20.05.2026"], 4);
  assert.equal(byDate["18.05.2026"], 4);
  assert.equal(byDate["03.05.2026"], 2);
  assert.equal(result.warnings.length, 2);
  assert.ok(result.warnings.every((warning) => warning.status === "missing_price"));
  assert.ok(rows.every((row) => Number(row[3]) > 0));
  assert.deepEqual(row1405?.slice(0, 6), [
    "14.05.2026",
    "Литвинов Андрей",
    "Программа обработки и компенсации страха военная",
    "200",
    "50%",
    "100",
  ]);
  assert.deepEqual(row1205?.slice(0, 6), [
    "12.05.2026",
    "Литвинов Андрей",
    "защитная программа, перерабатывающая негативные магические воздействия 1 уровня",
    "500",
    "50%",
    "250",
  ]);
  assert.deepEqual(rows0305.map((row) => [row[1], row[3], row[5]]), [
    ["Литвинов Андрей", "25", "12.5"],
    ["Литвинов Андрей", "50", "25"],
  ]);
  assert.equal(result.grandTotal, "637.5");
  assert.deepEqual(rowsAndTotal.at(-1), ["", "", "ИТОГО", "", "", "637.5"]);
});

test("parseManualOrdersTextDetailed parses inline date name order price lines", () => {
  const result = parseManualOrdersTextDetailed(
    "14 мая Литвинов Андрей - Программа обработки и компенсации страха военная 200",
    "2026-05-22"
  );

  assert.deepEqual(result.rows[0], [
    "14.05.2026",
    "Литвинов Андрей",
    "Программа обработки и компенсации страха военная",
    "200",
    "50%",
    "100",
  ]);
});

test("parseManualOrdersTextDetailed parses numeric date with default year", () => {
  const result = parseManualOrdersTextDetailed(
    "12.05 Литвинов Андрей - защитная программа, перерабатывающая негативные магические воздействия 1 уровня 500",
    "2026-05-22"
  );

  assert.deepEqual(result.rows[0], [
    "12.05.2026",
    "Литвинов Андрей",
    "защитная программа, перерабатывающая негативные магические воздействия 1 уровня",
    "500",
    "50%",
    "250",
  ]);
});

test("parseManualOrdersTextDetailed keeps quantities before ед inside order text", () => {
  const result = parseManualOrdersTextDetailed("3 мая\n1. Литвинов Андрей\nрегулировка военная программа 3 ед 50", "2026-05-22");

  assert.deepEqual(result.rows[0], ["03.05.2026", "Литвинов Андрей", "регулировка военная программа 3 ед", "50", "50%", "25"]);
});
