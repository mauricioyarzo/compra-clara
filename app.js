const STORAGE_KEY = "compra-clara-state-v1";
const money = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0
});

const els = {
  budgetInput: document.querySelector("#budgetInput"),
  totalAmount: document.querySelector("#totalAmount"),
  totalCard: document.querySelector("#totalCard"),
  budgetStatus: document.querySelector("#budgetStatus"),
  scanButton: document.querySelector("#scanButton"),
  manualButton: document.querySelector("#manualButton"),
  clearButton: document.querySelector("#clearButton"),
  emptyState: document.querySelector("#emptyState"),
  list: document.querySelector("#shoppingList"),
  template: document.querySelector("#itemTemplate"),
  scannerModal: document.querySelector("#scannerModal"),
  closeScanner: document.querySelector("#closeScanner"),
  cameraPreview: document.querySelector("#cameraPreview"),
  scannerMessage: document.querySelector("#scannerMessage"),
  productModal: document.querySelector("#productModal"),
  productTitle: document.querySelector("#productTitle"),
  productForm: document.querySelector("#productForm"),
  codeInput: document.querySelector("#codeInput"),
  nameInput: document.querySelector("#nameInput"),
  priceInput: document.querySelector("#priceInput"),
  quantityInput: document.querySelector("#quantityInput"),
  decreaseQty: document.querySelector("#decreaseQty"),
  increaseQty: document.querySelector("#increaseQty"),
  installButton: document.querySelector("#installButton")
};

let state = loadState();
let scannerStream = null;
let scannerTimer = null;
let deferredInstallPrompt = null;

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? { budget: "", items: [], catalog: {} };
  } catch {
    return { budget: "", items: [], catalog: {} };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toNumber(value, fallback = 0) {
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : fallback;
}

async function lookupProduct(code) {
  if (!code || state.catalog[code]) return state.catalog[code] ?? null;

  try {
    const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,product_name_es,brands`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.product) return null;

    const productName = data.product.product_name_es || data.product.product_name || "";
    const brand = data.product.brands?.split(",")[0]?.trim() || "";
    const name = [productName, brand].filter(Boolean).join(" - ");
    return name ? { name, price: "" } : null;
  } catch {
    return null;
  }
}

function total() {
  return state.items.reduce((sum, item) => sum + toNumber(item.price) * toNumber(item.quantity, 1), 0);
}

function render() {
  els.budgetInput.value = state.budget ?? "";
  els.list.textContent = "";
  els.emptyState.hidden = state.items.length > 0;

  for (const item of state.items) {
    const node = els.template.content.firstElementChild.cloneNode(true);
    const nameInput = node.querySelector(".item-name");
    const code = node.querySelector(".item-code");
    const qtyInput = node.querySelector(".item-qty");
    const priceInput = node.querySelector(".item-price");
    const subtotal = node.querySelector(".item-subtotal");
    const deleteButton = node.querySelector(".delete-button");

    nameInput.value = item.name;
    code.textContent = `Código ${item.code}`;
    qtyInput.value = item.quantity;
    priceInput.value = item.price;
    subtotal.textContent = money.format(toNumber(item.price) * toNumber(item.quantity, 1));

    nameInput.addEventListener("input", () => updateItem(item.id, { name: nameInput.value }));
    qtyInput.addEventListener("input", () => updateItem(item.id, { quantity: Math.max(1, toNumber(qtyInput.value, 1)) }));
    priceInput.addEventListener("input", () => updateItem(item.id, { price: Math.max(0, toNumber(priceInput.value)) }));
    deleteButton.addEventListener("click", () => removeItem(item.id));

    els.list.append(node);
  }

  updateSummary();
}

function updateSummary() {
  const amount = total();
  const budget = toNumber(state.budget);
  els.totalAmount.textContent = money.format(amount);
  els.totalCard.classList.remove("near", "over");

  if (!budget) {
    els.budgetStatus.textContent = "Sin presupuesto definido";
    return;
  }

  const difference = budget - amount;
  const percent = amount / budget;
  if (difference < 0) {
    els.totalCard.classList.add("over");
    els.budgetStatus.textContent = `Excede por ${money.format(Math.abs(difference))}`;
  } else if (percent >= 0.85) {
    els.totalCard.classList.add("near");
    els.budgetStatus.textContent = `Quedan ${money.format(difference)}`;
  } else {
    els.budgetStatus.textContent = `Quedan ${money.format(difference)}`;
  }
}

function updateItem(id, patch) {
  state.items = state.items.map((item) => {
    if (item.id !== id) return item;
    const next = { ...item, ...patch };
    state.catalog[next.code] = { name: next.name, price: next.price };
    return next;
  });
  saveState();
  render();
}

function removeItem(id) {
  state.items = state.items.filter((item) => item.id !== id);
  saveState();
  render();
}

async function openProductForm(code = "") {
  const known = state.catalog[code] ?? {};
  const found = known.name ? known : await lookupProduct(code);
  els.codeInput.value = code;
  els.nameInput.value = found?.name ?? "";
  els.priceInput.value = found?.price ?? "";
  els.quantityInput.value = 1;
  els.productTitle.textContent = code ? "Producto escaneado" : "Ingresar producto";
  showDialog(els.productModal);
  setTimeout(() => (found?.name ? els.priceInput : els.nameInput).focus(), 80);
}

function showDialog(dialog) {
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

function closeDialog(dialog) {
  if (typeof dialog.close === "function") {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
  }
}

async function startScanner() {
  if (!("BarcodeDetector" in window)) {
    openProductForm("");
    alert("Este navegador no tiene lector de códigos integrado. Puedes ingresar el código manualmente.");
    return;
  }

  try {
    showDialog(els.scannerModal);
    els.scannerMessage.textContent = "Solicitando permiso de cámara...";
    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });
    els.cameraPreview.srcObject = scannerStream;
    await els.cameraPreview.play();
    const detector = new BarcodeDetector({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"]
    });
    els.scannerMessage.textContent = "Apunta la cámara al código de barras.";

    scannerTimer = window.setInterval(async () => {
      if (els.cameraPreview.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      const codes = await detector.detect(els.cameraPreview);
      if (!codes.length) return;
      const code = codes[0].rawValue;
      stopScanner();
      closeDialog(els.scannerModal);
      openProductForm(code);
    }, 420);
  } catch (error) {
    stopScanner();
    closeDialog(els.scannerModal);
    openProductForm("");
    alert("No pude abrir la cámara. Revisa permisos del navegador o ingresa el producto manualmente.");
  }
}

function stopScanner() {
  if (scannerTimer) {
    clearInterval(scannerTimer);
    scannerTimer = null;
  }
  if (scannerStream) {
    scannerStream.getTracks().forEach((track) => track.stop());
    scannerStream = null;
  }
  els.cameraPreview.srcObject = null;
}

function addProductFromForm() {
  const code = els.codeInput.value.trim() || `manual-${Date.now()}`;
  const name = els.nameInput.value.trim();
  const price = Math.max(0, toNumber(els.priceInput.value));
  const quantity = Math.max(1, Math.floor(toNumber(els.quantityInput.value, 1)));

  if (!name) return;

  state.catalog[code] = { name, price };
  state.items.unshift({ id: uid(), code, name, price, quantity });
  saveState();
  closeDialog(els.productModal);
  render();
}

els.budgetInput.addEventListener("input", () => {
  state.budget = els.budgetInput.value;
  saveState();
  updateSummary();
});

els.scanButton.addEventListener("click", startScanner);
els.manualButton.addEventListener("click", () => openProductForm(""));
els.closeScanner.addEventListener("click", () => {
  stopScanner();
  closeDialog(els.scannerModal);
});

els.clearButton.addEventListener("click", () => {
  if (!state.items.length || confirm("¿Quieres limpiar la lista actual?")) {
    state.items = [];
    saveState();
    render();
  }
});

els.decreaseQty.addEventListener("click", () => {
  els.quantityInput.value = Math.max(1, toNumber(els.quantityInput.value, 1) - 1);
});

els.increaseQty.addEventListener("click", () => {
  els.quantityInput.value = toNumber(els.quantityInput.value, 1) + 1;
});

els.productForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addProductFromForm();
});

els.scannerModal.addEventListener("close", stopScanner);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  els.installButton.hidden = false;
});

els.installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  els.installButton.hidden = true;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

render();
