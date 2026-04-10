/**
 * mk-table.js — Маршрутная карта (МК) route table builder
 * Builds the MK section from the template in sections_template.json
 */

const { parametrize } = require('./operations');
const { calcProductMass, calcBlockMass, calcBatchMass } = require('./equipment');

/**
 * MK route data for each of the 29 operations
 * This defines the table rows for the Маршрутная Карта
 */
const MK_OPERATIONS = [
  {
    num: 1,
    name: 'Разгрузка сырьевого блока',
    equipment: 'Мостовой кран 5–16 т; погрузчик RH23',
    executor: 'Камнерез (допуск ПС); разнорабочий (допуск стропальщик); мастер цеха',
    control: 'Устойчивость блока на подкладках; визуальный осмотр на повреждения при разгрузке',
    notes: 'Масса блока ~{blockMassT} т. Нахождение под грузом --- ЗАПРЕЩЕНО'
  },
  {
    num: 2,
    name: 'Входной контроль сырья',
    equipment: 'Мостовой кран (при кантовании)',
    executor: 'Мастер цеха; диспетчер; разнорабочий',
    control: 'Геометрия блока (рулетка); наличие документов; отсутствие структурного брака',
    notes: 'Природные природные микротрещины, каверны --- не брак'
  },
  {
    num: 3,
    name: 'Сортировка по оттенку и зернистости',
    equipment: 'Мостовой кран (при кантовании)',
    executor: 'Мастер цеха; разнорабочий',
    control: 'Визуальный осмотр; классификация по оттенку; фиксация природных особенностей',
    notes: 'Категория 1 — подбор по оттенку и зернистости'
  },
  {
    num: 4,
    name: 'Разработка карты раскроя и маршрутной технологии',
    equipment: '—',
    executor: 'Мастер цеха; наладчик ЧПУ',
    control: 'Оптимальность раскроя; учёт дефектных зон; технологический запас',
    notes: 'Учёт ориентации текстуры при подборе'
  },
  {
    num: 5,
    name: 'Перемещение блока к станку, строповка',
    equipment: 'Мостовой кран 5–16 т; погрузчик RH23',
    executor: 'Камнерез (допуск ПС); разнорабочий (допуск стропальщик)',
    control: 'Правильность строповки; устойчивость при перемещении',
    notes: 'Масса блока ~{blockMassT} т'
  },
  {
    num: 6,
    name: 'Распиловка сырья на слэбы/заготовки (черновая)',
    equipment: 'SQC2200',
    executor: 'Камнерез; наладчик ЧПУ; разнорабочий',
    control: 'Толщина слэбов; перпендикулярность; отсутствие сколов',
    notes: 'Мокрая резка обязательна. Система водоочистки включена'
  },
  {
    num: 7,
    name: 'Межоперационный контроль после распила',
    equipment: 'Рулетка, штангенциркуль, линейка',
    executor: 'Мастер цеха; камнерез',
    control: 'Толщина, плоскостность, отсутствие трещин',
    notes: 'Фиксация в маршрутных документах'
  },
  {
    num: 8,
    name: 'Раскрой слэба на заготовки плит',
    equipment: 'SQC600-4D',
    executor: 'Камнерез; наладчик ЧПУ; разнорабочий',
    control: 'Размеры заготовок с учётом припуска; отсутствие сколов',
    notes: 'Технологический запас на чистовую обработку'
  },
  {
    num: 9,
    name: 'Калибровка плоскостей и толщины',
    equipment: 'JC-1010{jcNote}',
    executor: 'Камнерез; наладчик ЧПУ; разнорабочий',
    control: 'Толщина {thickness} мм ± допуск; плоскостность',
    notes: 'Абразив от грубого к тонкому. Водоочистка включена'
  },
  {
    num: 10,
    name: 'Контроль толщины/плоскостности после калибровки',
    equipment: 'Штангенциркуль, поверочная линейка, щупы',
    executor: 'Мастер цеха; камнерез',
    control: 'Толщина в нескольких точках; плоскостность; отсутствие волн',
    notes: 'Отклонения — на повторную калибровку'
  },
  {
    num: 11,
    name: 'Настройка/верификация программы ЧПУ',
    equipment: 'SQC600-4D (ЧПУ)',
    executor: 'Наладчик ЧПУ; мастер цеха',
    control: 'Соответствие программы чертежу; пробный прогон',
    notes: 'Контроль размеров {length}×{width} мм'
  },
  {
    num: 12,
    name: 'Черновое формообразование (чистовая обрезка)',
    equipment: 'SQC600-4D',
    executor: 'Камнерез; наладчик ЧПУ; разнорабочий',
    control: 'Размеры {length}×{width} мм ± допуск; перпендикулярность',
    notes: 'Мокрая резка. Прокладки между плитами'
  },
  {
    num: 13,
    name: 'Переворот/перестановка изделия на кромкообработку',
    equipment: 'Тельфер/кран (при партии); вручную вдвоём',
    executor: 'Камнерез; разнорабочий',
    control: 'Целостность поверхности после перестановки',
    notes: 'Масса плиты ~{pieceMass} кг'
  },
  {
    num: 14,
    name: 'Изготовление фасок по кромкам',
    equipment: 'SQC600-4D или ручной пневмоинструмент + D316Y',
    executor: 'Камнерез; разнорабочий',
    control: 'Ширина фасок по шаблону; равномерность',
    notes: '{edgesText}'
  },
  {
    num: 15,
    name: 'Ручная доводка фасок и переходов',
    equipment: 'Ручной инструмент; D316Y',
    executor: 'Камнерез; мастер цеха',
    control: 'Отсутствие рисок, сколов; ровность переходов',
    notes: 'Абразив нарастающей зернистости'
  },
  {
    num: 16,
    name: 'Зачистка после калибровки/фаскования',
    equipment: 'Ручной инструмент; D316Y',
    executor: 'Камнерез; мастер цеха',
    control: 'Отсутствие микросколов; качество кромок',
    notes: 'Влажная уборка пыли'
  },
  {
    num: 17,
    name_лощение: 'Подготовка к бучардированию — НЕ ПРИМЕНЯЕТСЯ',
    name_рельефная_матовая: 'Подготовка к рельефной матовой обработке',
    name_бучардирование_лощение: 'Подготовка к бучардированию (маскирование зон лощения)',
    equipment_лощение: '—',
    equipment_default: 'ZLMS 2600; защитные материалы',
    executor: 'Камнерез; мастер цеха',
    control_лощение: '—',
    control_default: 'Правильность маскирования; защита зон лощения',
    notes_лощение: 'Операция не предусмотрена для данного изделия',
    notes_default: 'Защита зон, не подлежащих текстурированию'
  },
  {
    num: 18,
    name_лощение: 'Бучардирование поверхности — НЕ ПРИМЕНЯЕТСЯ',
    name_рельефная_матовая: 'Нанесение рельефной матовой фактуры',
    name_бучардирование_лощение: 'Бучардирование верхней поверхности',
    equipment_лощение: '—',
    equipment_рельефная_матовая: 'ZLMS 2600; ручной пневмоинструмент; D316Y',
    equipment_бучардирование_лощение: 'ZLMS 2600; бучарда/пневмоинструмент; D316Y',
    executor: 'Камнерез; мастер цеха',
    control_лощение: '—',
    control_default: 'Равномерность фактуры; глубина рельефа',
    notes_лощение: 'Операция не предусмотрена для данного изделия',
    notes_default: 'Влажная обработка; СИЗ обязательны'
  },
  {
    num: 19,
    name_лощение: 'Контроль качества бучардирования — НЕ ПРИМЕНЯЕТСЯ',
    name_рельефная_матовая: 'Контроль качества рельефной матовой фактуры',
    name_бучардирование_лощение: 'Контроль качества бучардирования',
    equipment: 'Визуальный контроль; эталонный образец',
    executor: 'Мастер цеха; камнерез',
    control_лощение: '—',
    control_default: 'Соответствие эталонному образцу; равномерность',
    notes_лощение: 'Операция не предусмотрена для данного изделия',
    notes_default: 'При несоответствии — доводка (оп. №20)'
  },
  {
    num: 20,
    name_лощение: 'Доводка после бучардирования — НЕ ПРИМЕНЯЕТСЯ',
    name_рельефная_матовая: 'Доводка рельефной матовой фактуры',
    name_бучардирование_лощение: 'Доводка после бучардирования',
    equipment_лощение: '—',
    equipment_default: 'Ручной инструмент; D316Y',
    executor: 'Камнерез; мастер цеха',
    control_лощение: '—',
    control_default: 'Устранение дефектов; ровность границ фактур',
    notes_лощение: 'Операция не предусмотрена для данного изделия',
    notes_default: 'Послойная доводка без углубления в тело камня'
  },
  {
    num: 21,
    name: 'Подготовка к лощению (абразивы, настройка)',
    equipment: 'ZLMS 2600; SPG1200-12{spgNote}',
    executor: 'Камнерез; наладчик ЧПУ; мастер цеха',
    control: 'Подбор абразивов; настройка режимов; подача воды',
    notes: 'Абразивы от грубого к тонкому до сатинового блеска'
  },
  {
    num: 22,
    name: 'Лощение лицевых поверхностей',
    equipment: 'ZLMS 2600; SPG1200-12{spgNote}',
    executor: 'Камнерез; наладчик ЧПУ; разнорабочий',
    control: 'Равномерность блеска; отсутствие рисок; эталонный образец',
    notes: 'Мокрая обработка. Водоочистка включена'
  },
  {
    num: 23,
    name: 'Ручная шлифовка переходов после лощения',
    equipment: 'Ручной инструмент; D316Y',
    executor: 'Камнерез; мастер цеха',
    control: 'Ровность переходов; отсутствие рисок на лощёной поверхности',
    notes: 'Защита лощёных зон от повреждения'
  },
  {
    num: 24,
    name: 'Мойка, сушка, консервация',
    equipment: 'Мойка (водоочистка); сжатый воздух D316Y',
    executor: 'Камнерез; разнорабочий; мастер цеха',
    control: 'Чистота поверхности; отсутствие пятен/разводов',
    notes: 'Обеспыливание обязательно. Гидрофобизация при необходимости'
  },
  {
    num: 25,
    name: 'Контроль геометрии и профиля (финальный)',
    equipment: 'Рулетка, штангенциркуль, угольник, шаблоны',
    executor: 'Мастер цеха; директор производства (паспорт качества)',
    control: '{length}×{width}×{thickness} мм ± допуск; фаски; лощение; общий вид',
    notes: 'Приёмочный контроль по ГОСТ 9480-2024 и ГОСТ 23342-2012'
  },
  {
    num: 26,
    name: 'Комплектация партии и визуальный подбор',
    equipment: 'Тельфер/кран; вручную',
    executor: 'Мастер цеха; камнерез; разнорабочий',
    control: 'Однородность оттенка и зернистости в партии',
    notes: 'Категория 1 — строгий подбор'
  },
  {
    num: 27,
    name: 'Изготовление тары',
    equipment: 'Ручной инструмент; вилочный погрузчик',
    executor: 'Разнорабочий; мастер цеха',
    control: 'Несущая способность тары; фиксация изделий',
    notes: '{packagingNote}'
  },
  {
    num: 28,
    name: 'Упаковка, фиксация, маркировка',
    equipment: 'Вилочный погрузчик; тельфер',
    executor: 'Камнерез; разнорабочий; мастер цеха',
    control: 'Надёжность фиксации; маркировка по ГОСТ; документация',
    notes: 'Прокладки между плитами обязательны'
  },
  {
    num: 29,
    name: 'Погрузка на транспорт и крепление',
    equipment: 'Мостовой кран; вилочный погрузчик; тягач',
    executor: 'Камнерез; разнорабочий; водитель; мастер цеха',
    control: 'Распределение нагрузки; крепление растяжками',
    notes: 'Масса партии ~{batchMass} кг. Специалист БДД'
  }
];

/**
 * Resolve a field that may have texture-specific variants
 */
function resolveField(op, fieldName, texture) {
  // Try texture-specific key first
  const textureKey = `${fieldName}_${texture}`;
  if (op[textureKey] !== undefined) return op[textureKey];
  
  // Try default key
  const defaultKey = `${fieldName}_default`;
  if (op[defaultKey] !== undefined) return op[defaultKey];
  
  // Fall back to base field
  return op[fieldName] || '—';
}

/**
 * Build the MK header text
 */
function buildMKHeader(product) {
  const dims = product.dimensions;
  const texture = product.texture;
  
  const textureDescs = {
    'лощение': 'Трудозатраты не нормированы.',
    'рельефная_матовая': 'Трудозатраты не нормированы.\n\nОперации №17–20 --- рельефная матовая обработка.',
    'бучардирование_лощение': 'Трудозатраты не нормированы.\n\nОперации №17–20 --- бучардирование с последующим лощением.'
  };
  
  const header = `ЧАСТЬ II. МАРШРУТНАЯ КАРТА (МК)\n\nМаршрутная карта оформлена в соответствии с ГОСТ 3.1118-82 (ЕСТД, маршрутные карты). Содержит полный технологический маршрут производства ${product.name.toLowerCase()} ${dims.length}×${dims.width}×${dims.thickness} мм из ${product.material.type}а ${product.material.name}. ${textureDescs[texture] || textureDescs['лощение']}`;
  
  return header;
}

/**
 * Build MK table data (array of row objects)
 */
function buildMKTableData(product) {
  const dims = product.dimensions;
  const texture = product.texture;
  const pieceMass = Math.round(calcProductMass(product));
  const blockMassT = (calcBlockMass(product) / 1000).toFixed(1).replace('.', ',');
  const batchMass = calcBatchMass(product);
  
  const { applicable } = require('./equipment').analyzeEquipment(product);
  const jcNote = applicable['JC-1010'].fits ? '' : ' (НЕ ПРИМЕНИМ)';
  const spgNote = applicable['SPG1200-12'].fits ? '' : ' (НЕ ПРИМЕНИМА)';
  
  const packagingNotes = {
    'стандартная': 'Стандартная тара',
    'усиленная': 'Усиленная тара для длинномера',
    'индивидуальная': 'Индивидуальная тара по ТЗ'
  };
  const packagingNote = packagingNotes[product.packaging] || 'Тара по ТЗ';
  
  const rows = MK_OPERATIONS.filter(op => {
    // Skip non-applicable operations (ops 17-20 for лощение texture)
    if (op.num >= 17 && op.num <= 20 && texture === 'лощение') return false;
    return true;
  }).map(op => {
    let name = resolveField(op, 'name', texture);
    let equipment = resolveField(op, 'equipment', texture);
    let control = resolveField(op, 'control', texture);
    let notes = resolveField(op, 'notes', texture);
    
    // Substitute placeholders
    const replacements = {
      '{blockMassT}': blockMassT,
      '{pieceMass}': String(pieceMass),
      '{batchMass}': String(batchMass),
      '{length}': String(dims.length),
      '{width}': String(dims.width),
      '{thickness}': String(dims.thickness),
      '{jcNote}': jcNote,
      '{spgNote}': spgNote,
      '{edgesText}': product.edges || 'калибровка по всем сторонам',
      '{packagingNote}': packagingNote
    };
    
    for (const [key, val] of Object.entries(replacements)) {
      name = name.replace(new RegExp(escapeRegex(key), 'g'), val);
      equipment = equipment.replace(new RegExp(escapeRegex(key), 'g'), val);
      control = control.replace(new RegExp(escapeRegex(key), 'g'), val);
      notes = notes.replace(new RegExp(escapeRegex(key), 'g'), val);
    }
    
    return {
      num: op.num,
      name,
      equipment,
      executor: op.executor || resolveField(op, 'executor', texture),
      control,
      notes
    };
  });
  
  return rows;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  buildMKHeader,
  buildMKTableData,
  MK_OPERATIONS
};
