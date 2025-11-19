// ========================================
// 智能点名系统 - 核心脚本
// ========================================

// ========== 1. 状态变量 ==========
let names = [];
let calledNames = [];
let interval = null;
let rolling = false;
let rollingPool = []; // 新增：缓存滚动阶段的未点名单
let savedClasses = JSON.parse(localStorage.getItem("savedClasses") || "[]");
let currentClass = localStorage.getItem("currentClass") || "自定义班级";
let savedClassLists = JSON.parse(
  localStorage.getItem("savedClassLists") || "{}"
);
let maskMode = "default"; // "default" | "classSelect"
window.__confirmClassSelection = null; // 供遮罩统一回调使用

// ========== 2. DOM 元素引用 ==========
const nameDisplay = document.getElementById("nameDisplay");
const startButton = document.getElementById("startButton");
const selectClassBtn = document.getElementById("selectClassBtn");

const viewListBtn = document.getElementById("viewListBtn");
const addNameBtn = document.getElementById("addNameBtn");
const toggleBtn = document.getElementById("toggleCalledSidebar");

const rightDrawer = document.getElementById("rightDrawer");
const drawerTitle = document.getElementById("drawerTitle");
const drawerList = document.getElementById("drawerList");
const drawerActions = document.getElementById("drawerActions");

// ========== 3. 工具函数 - 数据转换 ==========
function chineseToNumber(ch) {
  if (!ch) return null;
  const map = {
    零: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
    十一: 11,
    十二: 12,
    十三: 13,
    十四: 14,
    十五: 15,
    十六: 16,
    十七: 17,
    十八: 18,
    十九: 19,
    二十: 20,
  };
  if (/^\d+$/.test(ch)) return parseInt(ch, 10);
  if (map[ch]) return map[ch];
  const m = ch.match(/[一二三四五六七八九十]+/);
  if (m && map[m[0]] !== undefined) return map[m[0]];
  return null;
}

function normalizeClassName(raw) {
  if (!raw) return "自定义班级";
  raw = raw.toString().trim();
  if (!raw) return "自定义班级";

  const m = raw.match(
    /(\d+|[一二三四五六七八九十]+)\s*年级.*?([（(]?(\d+|[一二三四五六七八九十]+)[）)]?)?\s*班/
  );
  if (m) {
    const g = chineseToNumber(m[1]) || m[1];
    const cnum = chineseToNumber(m[3] || "") || m[3] || "1";
    return `${g}年级-（${cnum}）班`;
  }

  const m2 = raw.match(
    /(高|初)?\s*([一二三四五六七八九十]|\d+)\s*.*?[（(]?(\d+|[一二三四五六七八九十]+)?[）)]?\s*班/
  );
  if (m2) {
    const g = chineseToNumber(m2[2]) || m2[2];
    const cnum = chineseToNumber(m2[3] || "") || m2[3] || "1";
    return `${g}年级-（${cnum}）班`;
  }

  const solo = raw.match(/^(\d+|[一二三四五六七八九十]+)$/);
  if (solo) {
    const g = chineseToNumber(solo[1]) || solo[1];
    return `${g}年级-（1）班`;
  }

  return raw;
}

function parseGradeClassFromLabel(label) {
  if (!label) return { grade: Infinity, cls: Infinity };
  const s = label.toString();
  const m = s.match(
    /(\d+|[一二三四五六七八九十]+)\s*年级[^\d零一二三四五六七八九十]*(\d+|[一二三四五六七八九十]+)?\s*班/
  );
  if (m) {
    const g = chineseToNumber(m[1]) || parseInt(m[1], 10) || Infinity;
    const c =
      chineseToNumber(m[2]) ||
      (m[2] ? parseInt(m[2], 10) : Infinity) ||
      Infinity;
    return { grade: g, cls: c };
  }

  const m2 = s.match(
    /(?:高|初)?\s*([一二三四五六七八九十]|\d+)\D*?(?:（|\(|\[)?(\d+|[一二三四五六七八九十]+)?(?:）|\)|\])?\s*班/
  );
  if (m2) {
    const g = chineseToNumber(m2[1]) || parseInt(m2[1], 10) || Infinity;
    const c =
      chineseToNumber(m2[2]) ||
      (m2[2] ? parseInt(m2[2], 10) : Infinity) ||
      Infinity;
    return { grade: g, cls: c };
  }

  const nums = s.match(/(\d+)/g) || [];
  if (nums.length >= 2)
    return { grade: parseInt(nums[0], 10), cls: parseInt(nums[1], 10) };
  if (nums.length === 1) return { grade: Infinity, cls: parseInt(nums[0], 10) };

  return { grade: Infinity, cls: Infinity };
}

function detectNameKey(json) {
  if (!json || json.length === 0) return null;

  const keys = Array.from(new Set(json.flatMap((r) => Object.keys(r || {}))));
  const headerKey = keys.find((k) => /姓名|名字/.test(k));
  if (headerKey) return headerKey;

  for (const k of keys) {
    let count = 0;
    for (let i = 0; i < Math.min(json.length, 10); i++) {
      const v = (json[i][k] || "").toString().trim();
      if (/^[\u4e00-\u9fa5]{2,4}$/.test(v) || /^[A-Za-z]+\s+[A-Za-z]+$/.test(v))
        count++;
    }
    if (count >= Math.min(3, json.length)) return k;
  }

  return keys[0] || null;
}

// ========== 4. 工具函数 - localStorage 保存 ==========
function saveNamesToLocal() {
  saveAllStateToLocal();
}

function saveAllStateToLocal() {
  localStorage.setItem("savedNames", JSON.stringify(names));
  localStorage.setItem("savedCalled", JSON.stringify(calledNames));
  localStorage.setItem("savedClasses", JSON.stringify(savedClasses));
  localStorage.setItem("currentClass", currentClass);
  localStorage.setItem("savedClassLists", JSON.stringify(savedClassLists));
}

// ========== 5. 工具函数 - UI 更新 ==========
function showPreviewForClass(classLabel, listOverride) {
  const previewDiv = document.getElementById("importPreview");
  if (!previewDiv) return;
  const list = listOverride || savedClassLists[classLabel] || [];
  previewDiv.innerHTML = "";
  const title = document.createElement("div");
  title.style.fontWeight = "600";
  title.style.marginBottom = "6px";
  title.textContent = `预览： ${classLabel} （共 ${list.length} 人）`;
  previewDiv.appendChild(title);
  const ol = document.createElement("ol");
  ol.style.paddingLeft = "20px";
  const slice = list.slice(0, 10);
  slice.forEach((n) => {
    const li = document.createElement("li");
    li.textContent = n;
    ol.appendChild(li);
  });
  previewDiv.appendChild(ol);
  if (list.length > 10) {
    const more = document.createElement("div");
    more.style.marginTop = "6px";
    more.style.fontSize = "0.9em";
    more.style.opacity = "0.85";
    more.textContent = `... 共 ${list.length} 人，显示前 10 名`;
    previewDiv.appendChild(more);
  }
}

function updateCountDisplay() {
  if (names.length === 0) {
    nameDisplay.innerHTML =
      '<span class="text-3xl opacity-90">请导入名单</span>';
  } else {
    nameDisplay.innerHTML = `<span class="text-3xl opacity-90">名单中共有 ${names.length} 人</span>`;
  }
}

function renderCalledList() {
  if (
    rightDrawer.classList.contains("show") &&
    drawerTitle.textContent.includes("已点名单")
  ) {
    openDrawer({ title: "✅ 已点名单", type: "calledList" });
  }
}

function updateCalledSidebarButton() {
  const count = calledNames.length;
  toggleBtn.textContent = count > 0 ? `📘 已点：${count}人` : "📘 已点名单";
}

// ========== 6. 文件解析功能 ==========
async function parseFileForNames(file, options = {}) {
  const rawClass = options.rawClass === true;
  const fileName = file.name.toLowerCase();
  let parsedNames = [];
  let detectedGrade = "";
  let detectedClass = "";
  const classMap = {};

  if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      alert("表格里没有可用的 sheet");
      return { names: [], grade: "", cls: "", classLabel: "自定义班级" };
    }

    const sheet = workbook.Sheets[firstSheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (!Array.isArray(json) || json.length === 0) {
      alert("第一个 sheet 没有数据，请检查文件");
      return { names: [], grade: "", cls: "", classLabel: "自定义班级" };
    }

    const keys = Array.from(new Set(json.flatMap((r) => Object.keys(r || {}))));
    const nameKey = detectNameKey(json) || keys[0];
    const gradeKey = keys.find((k) => /年级/.test(k));
    const classKey = keys.find((k) => /班级/.test(k));

    json.forEach((r) => {
      const name = (r[nameKey] || "").toString().trim();
      if (!name) return;
      let classVal = "";
      if (classKey) classVal = (r[classKey] || "").toString().trim();
      else if (gradeKey) classVal = (r[gradeKey] || "").toString().trim();
      else {
        const combinedKey = keys.find((k) =>
          /(年级.*班|年级.*班级|班级.*年级)/.test(k)
        );
        if (combinedKey) {
          const combined = (r[combinedKey] || "").toString();
          const m = combined.match(
            /(\d+|[一二三四五六七八九十]+)年级.*?([（(]?(\d+)[）)]?)?班/
          );
          if (m) classVal = m[0];
        }
      }
      const keyLabel = rawClass
        ? classVal || "自定义班级"
        : normalizeClassName(classVal || "自定义班级");
      if (!classMap[keyLabel]) classMap[keyLabel] = [];
      classMap[keyLabel].push(name);
      parsedNames.push(name);
    });

    if (gradeKey || classKey) {
      const first = json[0] || {};
      if (gradeKey) detectedGrade = (first[gradeKey] || "").toString().trim();
      if (classKey) {
        const allClasses = Array.from(
          new Set(
            json
              .map((r) => (r[classKey] || "").toString().trim())
              .filter((v) => v)
          )
        );
        detectedClass =
          allClasses.length === 1
            ? allClasses[0]
            : (first[classKey] || "").toString().trim();
      }
    } else {
      const combinedKey = keys.find((k) =>
        /(年级.*班|年级.*班级|班级.*年级)/.test(k)
      );
      if (combinedKey) {
        const combined = (json[0][combinedKey] || "").toString();
        const m = combined.match(
          /(\d+|[一二三四五六七八九十]+)年级.*?([（(]?(\d+)[）)]?)?班/
        );
        if (m) {
          detectedGrade = m[1];
          detectedClass = m[3] || "";
        }
      }
    }
  } else if (fileName.endsWith(".docx")) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await window.mammoth.convertToHtml({ arrayBuffer });
    const div = document.createElement("div");
    div.innerHTML = result.value;
    const tables = div.querySelectorAll("table");
    if (tables.length > 0) {
      const rows = tables[0].querySelectorAll("tr");
      const headers = Array.from(rows[0].querySelectorAll("td,th")).map((td) =>
        td.textContent.trim()
      );
      const nameIndex = headers.findIndex((h) => /姓名|名字/.test(h));
      const gradeIndex = headers.findIndex((h) => /年级/.test(h));
      const classIndex = headers.findIndex((h) => /班级/.test(h));
      if (nameIndex !== -1) {
        const classValues = [];
        for (let i = 1; i < rows.length; i++) {
          const cells = rows[i].querySelectorAll("td,th");
          const name =
            (cells[nameIndex] && cells[nameIndex].textContent.trim()) || "";
          if (!name) continue;
          let classVal = "";
          if (classIndex !== -1)
            classVal =
              (cells[classIndex] && cells[classIndex].textContent.trim()) || "";
          else if (gradeIndex !== -1)
            classVal =
              (cells[gradeIndex] && cells[gradeIndex].textContent.trim()) || "";
          const keyLabel = rawClass
            ? classVal || "自定义班级"
            : normalizeClassName(classVal || "自定义班级");
          if (!classMap[keyLabel]) classMap[keyLabel] = [];
          classMap[keyLabel].push(name);
          parsedNames.push(name);
          if (classIndex !== -1 && classVal) classValues.push(classVal);
          if (gradeIndex !== -1 && (!detectedGrade || detectedGrade === ""))
            detectedGrade =
              (cells[gradeIndex] && cells[gradeIndex].textContent.trim()) ||
              detectedGrade;
        }
        if (classIndex !== -1) {
          const uniques = Array.from(new Set(classValues));
          detectedClass =
            uniques.length === 1
              ? uniques[0]
              : (rows[1] &&
                  rows[1].querySelectorAll("td,th")[classIndex] &&
                  rows[1]
                    .querySelectorAll("td,th")
                    [classIndex].textContent.trim()) ||
                detectedClass;
        }
      } else {
        alert("未检测到 Word 表格，请使用含“姓名”列的表格！");
      }
    } else {
      alert("未检测到 Word 表格，请使用含“姓名”列的表格！");
    }
  } else {
    alert("请导入 Excel 或 Word 文件！");
    return { names: [], grade: "", cls: "", classLabel: "自定义班级" };
  }

  let classLabel = "";
  const classKeys = Object.keys(classMap);
  if (classKeys.length === 1 && parsedNames.length > 0) {
    classLabel = classKeys[0];
  }
  if (!classLabel) {
    if (detectedGrade || detectedClass) {
      const g =
        detectedGrade.toString().replace(/[^0-9一二三四五六七八九十]/g, "") ||
        detectedGrade;
      const cDigits = detectedClass.toString().replace(/[^0-9]/g, "");
      if (
        detectedClass &&
        !/^\d+$/.test(detectedClass.replace(/[^0-9]/g, ""))
      ) {
        classLabel = detectedClass;
      } else if (g && cDigits) {
        classLabel = `${g}年级-（${cDigits}）班`;
      } else if (g && !cDigits) {
        classLabel = `${g}年级-（1）班`;
      } else if (!g && cDigits) {
        classLabel = `自定义年级-（${cDigits}）班`;
      } else {
        classLabel = detectedClass || "自定义班级";
      }
    }
  }
  if (!classLabel) classLabel = "自定义班级";
  return {
    names: parsedNames,
    grade: detectedGrade,
    cls: detectedClass,
    classLabel,
    classMap,
  };
}

// ========== 7. 点名功能 ==========
startButton.addEventListener("click", () => {
  if (names.length === 0) {
    alert("请先导入名单！");
    return;
  }

  if (!rolling) {
    const calledSet = new Set(calledNames);
    rollingPool = names.filter((n) => !calledSet.has(n));

    if (rollingPool.length === 0) {
      alert("已点完所有名单！");
      return;
    }

    rolling = true;
    startButton.textContent = "⏸ 确认点名";

    interval = setInterval(() => {
      if (rollingPool.length === 0) {
        clearInterval(interval);
        rolling = false;
        startButton.textContent = "▶ 开始点名";
        alert("已点完所有名单！");
        return;
      }
      const randomIndex = Math.floor(Math.random() * rollingPool.length);
      const name = rollingPool[randomIndex];
      nameDisplay.innerHTML = `<span class="text-6xl font-extrabold">${name}</span>`;
    }, 80);
  } else {
    rolling = false;
    clearInterval(interval);
    startButton.textContent = "▶ 开始点名";
    const selectedName = nameDisplay.textContent;
    if (selectedName.trim() !== "" && !calledNames.includes(selectedName)) {
      calledNames.push(selectedName);
      renderCalledList();
      updateCalledSidebarButton();
    }
  }
});

// ========== 8. 抽屉功能 ==========
const drawerMask = document.createElement("div");
drawerMask.style.position = "fixed";
drawerMask.style.top = "0";
drawerMask.style.left = "0";
drawerMask.style.width = "100vw";
drawerMask.style.height = "100vh";
drawerMask.style.background = "rgba(0,0,0,0.3)";
drawerMask.style.zIndex = "60";
drawerMask.style.display = "none";
document.body.appendChild(drawerMask);

function closeDrawer() {
  rightDrawer.classList.remove("show");
  drawerMask.style.display = "none";
  maskMode = "default";
  window.__confirmClassSelection = null;
}

drawerMask.addEventListener("click", (e) => {
  if (e.target !== drawerMask) return;

  if (
    maskMode === "classSelect" &&
    typeof window.__confirmClassSelection === "function"
  ) {
    window.__confirmClassSelection();
  } else {
    closeDrawer();
  }
});

function openDrawer({ title, type }) {
  drawerTitle.textContent = title;
  drawerList.innerHTML = "";
  drawerActions.innerHTML = "";
  drawerList.onclick = null;
  drawerMask.style.display = "block";
  maskMode = "default";
  window.__confirmClassSelection = null;

  if (type === "calledList") {
    const frag = document.createDocumentFragment();
    calledNames.forEach((n, idx) => {
      const li = document.createElement("li");
      li.classList.add(
        "flex",
        "justify-between",
        "items-center",
        "hover:bg-white/10",
        "px-2",
        "rounded-md",
        "transition-all"
      );
      const span = document.createElement("span");
      span.textContent = `${idx + 1}. ${n}`;
      const delBtn = document.createElement("button");
      delBtn.textContent = "❌";
      delBtn.className =
        "ml-2 opacity-0 hover:opacity-100 transition-opacity text-red-400";
      delBtn.style.cursor = "pointer";
      delBtn.dataset.name = n;
      li.appendChild(span);
      li.appendChild(delBtn);
      frag.appendChild(li);
    });
    drawerList.appendChild(frag);

    drawerList.onclick = (e) => {
      const btn = e.target.closest("button");
      if (!btn || !btn.dataset.name) return;
      const n = btn.dataset.name;
      const cidx = calledNames.indexOf(n);
      if (cidx !== -1) calledNames.splice(cidx, 1);

      const li = btn.closest("li");
      if (li && li.parentNode === drawerList) {
        drawerList.removeChild(li);
      }
      Array.from(drawerList.children).forEach((item, index) => {
        const span = item.querySelector("span");
        if (span && calledNames[index] !== undefined) {
          span.textContent = `${index + 1}. ${calledNames[index]}`;
        }
      });

      updateCalledSidebarButton();
      updateCountDisplay();
      saveAllStateToLocal();
    };

    const clearBtn = document.createElement("button");
    clearBtn.textContent = "🧹 清空名单";
    clearBtn.style.width = "50%";
    clearBtn.className = "clear-called-btn";
    clearBtn.addEventListener("click", () => {
      calledNames = [];
      drawerList.innerHTML = "";
      updateCalledSidebarButton();
      closeDrawer();
      saveAllStateToLocal();
    });
    drawerActions.appendChild(clearBtn);
  } else if (type === "fullList") {
    const frag = document.createDocumentFragment();
    names.forEach((n, idx) => {
      const li = document.createElement("li");
      li.classList.add(
        "flex",
        "justify-between",
        "items-center",
        "hover:bg-white/10",
        "px-2",
        "rounded-md",
        "transition-all"
      );
      const span = document.createElement("span");
      span.textContent = `${idx + 1}. ${n}`;
      const delBtn = document.createElement("button");
      delBtn.textContent = "❌";
      delBtn.className =
        "ml-2 opacity-0 hover:opacity-100 transition-opacity text-red-400";
      delBtn.style.cursor = "pointer";
      delBtn.dataset.name = n;
      li.appendChild(span);
      li.appendChild(delBtn);
      frag.appendChild(li);
    });
    drawerList.appendChild(frag);

    drawerList.onclick = (e) => {
      const btn = e.target.closest("button");
      if (!btn || !btn.dataset.name) return;
      const n = btn.dataset.name;
      const idx = names.indexOf(n);
      if (idx !== -1) names.splice(idx, 1);

      const cidx = calledNames.indexOf(n);
      if (cidx !== -1) calledNames.splice(cidx, 1);

      const li = btn.closest("li");
      if (li && li.parentNode === drawerList) {
        drawerList.removeChild(li);
      }
      Array.from(drawerList.children).forEach((item, index) => {
        const span = item.querySelector("span");
        if (span && names[index] !== undefined) {
          span.textContent = `${index + 1}. ${names[index]}`;
        }
      });

      updateCountDisplay();
      saveAllStateToLocal();
    };

    const closeBtn = document.createElement("button");
    closeBtn.textContent = `${currentClass} （ 共${names.length}人 ）`;
    closeBtn.style.width = "70%";
    closeBtn.className = "clear-called-btn";
    closeBtn.style.cursor = "default";
    closeBtn.style.pointerEvents = "none";
    drawerActions.appendChild(closeBtn);
  } else if (type === "addName") {
    const inputContainer = document.createElement("div");
    inputContainer.style.flex = "1";
    inputContainer.style.display = "flex";
    inputContainer.style.alignItems = "center";
    inputContainer.style.justifyContent = "center";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "输入姓名";
    input.className = "drawer-add-input";
    inputContainer.appendChild(input);
    drawerList.appendChild(inputContainer);
    const btnContainer = document.createElement("div");
    btnContainer.style.display = "flex";
    btnContainer.style.justifyContent = "center";
    btnContainer.style.marginTop = "auto";
    btnContainer.style.gap = "8px";
    btnContainer.style.width = "50%";
    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = " 确认 ";
    confirmBtn.className = "clear-called-btn";
    confirmBtn.style.flex = "1";
    confirmBtn.style.width = "100%";
    confirmBtn.style.fontSize = "1.05rem";
    confirmBtn.style.fontWeight = "600";
    confirmBtn.addEventListener("click", () => {
      const newName = input.value.trim();
      if (!newName) {
        alert("请输入姓名！");
        return;
      }
      if (names.includes(newName)) {
        alert(`${newName} 已在名单中`);
        return;
      }
      names.push(newName);
      updateCountDisplay();
      renderCalledList();
      updateCalledSidebarButton();
      closeDrawer();
      saveAllStateToLocal();
    });
    btnContainer.appendChild(confirmBtn);
    drawerActions.style.justifyContent = "center";
    drawerActions.appendChild(btnContainer);
    input.focus();
  }

  rightDrawer.classList.add("show");
}

toggleBtn.addEventListener("click", () =>
  openDrawer({ title: "✅ 已点名单", type: "calledList" })
);
viewListBtn.addEventListener("click", () =>
  openDrawer({ title: "📋 全部名单", type: "fullList" })
);
addNameBtn.addEventListener("click", () =>
  openDrawer({ title: "➕ 添加姓名", type: "addName" })
);

// ========== 9. 班级选择功能 ==========
function openClassDrawer() {
  drawerTitle.textContent = "🎓 选择班级";
  drawerList.innerHTML = "";
  drawerActions.innerHTML = "";
  drawerMask.style.display = "block";
  maskMode = "classSelect";

  const select = document.createElement("select");
  select.id = "classSelect";
  select.className = "class-select";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "请选择班级或导入后自动填充";
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);

  if (
    savedClasses.length === 1 &&
    savedClasses[0] === "自定义班级" &&
    savedClassLists["自定义班级"] &&
    savedClassLists["自定义班级"].length > 0
  ) {
    const opt = document.createElement("option");
    opt.value = "自定义班级";
    opt.textContent = "自定义班级";
    select.appendChild(opt);
  }
  if (!(savedClasses.length === 1 && savedClasses[0] === "自定义班级")) {
    savedClasses.forEach((cls) => {
      if (!cls || !savedClassLists[cls] || savedClassLists[cls].length === 0)
        return;
      if (cls === "自定义班级") return;
      const opt = document.createElement("option");
      opt.value = cls;
      opt.textContent = cls;
      select.appendChild(opt);
    });
  }
  if (currentClass && savedClasses.includes(currentClass))
    select.value = currentClass;

  const selectContainer = document.createElement("div");
  selectContainer.style.display = "flex";
  selectContainer.style.gap = "8px";
  selectContainer.style.alignItems = "center";
  selectContainer.appendChild(select);

  const editBtn = document.createElement("button");
  editBtn.textContent = "✏️ 修改";
  editBtn.className = "menu-btn";
  editBtn.style.flexShrink = "0";
  const optionCount = select.options.length - 1;
  editBtn.style.display = optionCount === 1 ? "inline-block" : "none";

  editBtn.addEventListener("click", () => {
    const currentName = select.value || "自定义班级";
    const custom = prompt("请输入班级名称", currentName);
    if (custom !== null && custom.trim()) {
      const newClass = custom.trim();
      if (newClass !== currentName && savedClassLists[currentName]) {
        savedClassLists[newClass] = savedClassLists[currentName];
        delete savedClassLists[currentName];
        savedClasses = [newClass];
        currentClass = newClass;

        for (let i = 0; i < select.options.length; i++) {
          if (select.options[i].value === currentName) {
            select.options[i].value = newClass;
            select.options[i].textContent = newClass;
            select.value = newClass;
            break;
          }
        }
        showPreviewForClass(newClass);
        saveAllStateToLocal();
      }
    }
  });

  selectContainer.appendChild(editBtn);

  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.gap = "8px";
  container.appendChild(selectContainer);
  drawerList.appendChild(container);

  select.addEventListener("change", () => {
    const v = select.value || "自定义班级";
    showPreviewForClass(v);
  });

  const previewDiv = document.createElement("div");
  previewDiv.id = "importPreview";
  previewDiv.style.marginTop = "12px";
  previewDiv.style.maxHeight = "240px";
  previewDiv.style.overflow = "auto";
  drawerList.appendChild(previewDiv);

  const importClassBtn = document.createElement("button");
  importClassBtn.textContent = "📂 导入自定义名单";
  importClassBtn.style.fontSize = "0.9rem";
  importClassBtn.className = "menu-btn";

  const importSchoolBtn = document.createElement("button");
  importSchoolBtn.textContent = "🏫 导入学校总名单";
  importSchoolBtn.style.fontSize = "0.9rem";
  importSchoolBtn.className = "menu-btn";

  drawerActions.style.justifyContent = "center";
  const drawerFileInput = document.createElement("input");
  drawerFileInput.type = "file";
  drawerFileInput.accept = ".xlsx,.xls,.docx";
  drawerFileInput.hidden = true;

  let importMode = null;

  importClassBtn.addEventListener("click", () => {
    importMode = "class";
    drawerFileInput.click();
  });

  importSchoolBtn.addEventListener("click", () => {
    importMode = "school";
    drawerFileInput.click();
  });

  drawerFileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    names = [];
    savedClasses = [];
    savedClassLists = {};
    currentClass = "自定义班级";
    updateCountDisplay();
    renderCalledList();

    if (importMode === "class") {
      const res = await parseFileForNames(file);
      const allNames = Array.from(new Set(res.names || []));
      if (allNames.length === 0) {
        alert("导入失败：未检测到有效姓名，导入已取消");
        drawerFileInput.value = "";
        return;
      }
      names = allNames;
      savedClasses = ["自定义班级"];
      savedClassLists = { 自定义班级: allNames };
      currentClass = "自定义班级";
      Array.from(select.options).forEach((opt) => {
        if (opt.value) opt.remove();
      });
      const customOpt = document.createElement("option");
      customOpt.value = "自定义班级";
      customOpt.textContent = "自定义班级";
      select.appendChild(customOpt);
      select.value = "自定义班级";
      showPreviewForClass("自定义班级");
      const classOptionCount = select.options.length - 1;
      editBtn.style.display = classOptionCount === 1 ? "inline-block" : "none";
    } else if (importMode === "school") {
      const res = await parseFileForNames(file, { rawClass: true });
      const classMap = res.classMap || {};
      const keys = Object.keys(classMap || {});
      const filtered = keys.filter((k) => {
        const arr = Array.isArray(classMap[k]) ? classMap[k] : [];
        return k && k.toString().trim() !== "" && arr.length > 0;
      });
      filtered.sort((a, b) => {
        const pa = parseGradeClassFromLabel(a || "");
        const pb = parseGradeClassFromLabel(b || "");
        if (pa.grade !== pb.grade)
          return (pa.grade || Infinity) - (pb.grade || Infinity);
        if (pa.cls !== pb.cls)
          return (pa.cls || Infinity) - (pb.cls || Infinity);
        return a.localeCompare(b, "zh-Hans-CN");
      });
      if (filtered.length === 0) {
        alert("导入失败：未检测到有效的班级或姓名，导入已取消");
        drawerFileInput.value = "";
        return;
      }
      filtered.forEach((k) => {
        savedClassLists[k] = Array.from(new Set(classMap[k]));
      });
      savedClasses = filtered;
      const flat = [];
      keys.forEach((k) => savedClassLists[k].forEach((n) => flat.push(n)));
      names = Array.from(new Set(flat));
      currentClass = savedClasses[0] || "自定义班级";
      Array.from(select.options).forEach((opt) => {
        if (opt.value) opt.remove();
      });
      filtered.forEach((k) => {
        const opt = document.createElement("option");
        opt.value = k;
        opt.textContent = k;
        select.insertBefore(opt, select.lastElementChild);
      });
      select.value = currentClass;
      showPreviewForClass(currentClass);
      const schoolOptionCount = select.options.length - 1;
      editBtn.style.display = schoolOptionCount === 1 ? "inline-block" : "none";
    }
    savedClasses = Array.from(new Set(savedClasses));
    saveAllStateToLocal();
    updateCountDisplay();
    renderCalledList();
    drawerFileInput.value = "";
    calledNames = [];
    updateCalledSidebarButton();
  });

  const actionRow = document.createElement("div");
  actionRow.style.display = "flex";
  actionRow.style.justifyContent = "flex-end";
  actionRow.style.gap = "8px";
  actionRow.appendChild(importClassBtn);
  actionRow.appendChild(importSchoolBtn);
  actionRow.appendChild(drawerFileInput);
  drawerActions.appendChild(actionRow);

  const confirmSelection = () => {
    let val = select.value || "自定义班级";
    if (val === "") return;
    currentClass = val;
    names = Array.from(new Set(savedClassLists[currentClass] || []));
    saveAllStateToLocal();
    updateCountDisplay();
    renderCalledList();
    closeDrawer();
  };

  window.__confirmClassSelection = () => {
    confirmSelection();
  };

  select.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmSelection();
    }
  });

  rightDrawer.classList.add("show");
}

selectClassBtn && selectClassBtn.addEventListener("click", openClassDrawer);

// ========== 10. 初始化 ==========
const savedNames = JSON.parse(localStorage.getItem("savedNames") || "[]");
const savedCalled = JSON.parse(localStorage.getItem("savedCalled") || "[]");
names = savedNames;
calledNames = savedCalled;

updateCountDisplay();
updateCalledSidebarButton();

// ========== 11. 帮助功能 ==========
const helpBtn = document.getElementById("helpBtn");
const helpDrawer = document.getElementById("helpDrawer");

helpBtn.addEventListener("click", () => {
  helpDrawer.classList.toggle("show");
});

document.addEventListener("click", (e) => {
  if (!helpBtn.contains(e.target) && !helpDrawer.contains(e.target)) {
    helpDrawer.classList.remove("show");
  }
});
