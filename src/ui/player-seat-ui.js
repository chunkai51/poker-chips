// src/ui/player-seat-ui.js
// DOM builders for visual player seats around the poker table.

import { createButton } from "./ui-dom.js";

export function closeSeatDetailPopovers() {
  document.querySelectorAll(".seat-detail-popover").forEach(popover => popover.remove());
  document.querySelectorAll(".player-box.is-detail-open").forEach(box => {
    box.classList.remove("is-detail-open");
    box.setAttribute("aria-expanded", "false");
  });
}

function getPositionMarkers(position = "") {
  const markers = [];
  const isDealer = position.includes("Dealer");
  const isSmallBlind = position.includes("小盲");
  if (isDealer && isSmallBlind) {
    markers.push(["D/SB", "dealer-small-blind"]);
  } else if (isDealer) {
    markers.push(["D", "dealer"]);
  } else if (isSmallBlind) {
    markers.push(["SB", "small-blind"]);
  }
  if (position.includes("大盲")) markers.push(["BB", "big-blind"]);
  return markers;
}

function createPositionMarker(label, type) {
  const marker = document.createElement("span");
  marker.className = `seat-marker seat-marker-${type}`;
  marker.textContent = label;
  return marker;
}

function createSeatDetailPopover({ title, rows, claim }) {
  const popover = document.createElement("div");
  popover.className = "seat-detail-popover";
  popover.setAttribute("role", "tooltip");
  popover.addEventListener("click", event => event.stopPropagation());

  const titleEl = document.createElement("strong");
  titleEl.textContent = title;
  popover.appendChild(titleEl);

  rows.forEach(([label, value]) => {
    const row = document.createElement("span");
    const labelEl = document.createElement("em");
    labelEl.textContent = label;
    const valueEl = document.createElement("b");
    valueEl.textContent = value;
    row.append(labelEl, valueEl);
    popover.appendChild(row);
  });

  if (claim) {
    const claimButton = createButton(claim.label, () => {
      claim.onClick();
      closeSeatDetailPopovers();
    }, claim.disabled, "seat-claim-button");
    if (claim.claimed) claimButton.classList.add("claimed");
    popover.appendChild(claimButton);
  }

  return popover;
}

function toggleSeatDetail(box, detail) {
  const alreadyOpen = box.classList.contains("is-detail-open");
  closeSeatDetailPopovers();
  if (alreadyOpen) return;

  box.classList.add("is-detail-open");
  box.setAttribute("aria-expanded", "true");
  box.appendChild(createSeatDetailPopover(detail));
}

export function createPlayerSeatBox({
  index,
  seat,
  side,
  isMine = false,
  folded = false,
  allIn = false,
  inactive = false,
  active = false,
  ariaLabel,
  identityLabel,
  compactIdentityLabel,
  chips,
  bet,
  statusLabel,
  compactStatusLabel,
  position = "",
  detailRows = [],
  claim = null
}) {
  const box = document.createElement("div");
  box.classList.add("player-box");
  box.classList.add(side);
  if (isMine) box.classList.add("is-mine");
  if (folded) box.classList.add("folded");
  if (allIn) box.classList.add("all-in");
  if (inactive) box.classList.add("seat-inactive");
  if (active) box.classList.add("active");
  box.style.setProperty("--seat-left", `${seat.left}%`);
  box.style.setProperty("--seat-top", `${seat.top}%`);
  box.style.setProperty("--seat-left-mobile", `${seat.mobileLeft}%`);
  box.style.setProperty("--seat-top-mobile", `${seat.mobileTop}%`);
  box.setAttribute("aria-label", ariaLabel);
  box.setAttribute("role", "button");
  box.setAttribute("aria-expanded", "false");
  box.tabIndex = 0;

  const detail = {
    title: identityLabel,
    rows: detailRows,
    claim
  };
  box.addEventListener("click", () => {
    toggleSeatDetail(box, detail);
  });
  box.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleSeatDetail(box, detail);
  });

  const main = document.createElement("div");
  main.className = "player-seat-main";
  const name = document.createElement("h3");
  name.className = "player-name";
  name.textContent = compactIdentityLabel;
  main.appendChild(name);

  const chipValue = document.createElement("p");
  chipValue.className = "seat-chip";
  chipValue.textContent = String(chips);
  main.appendChild(chipValue);
  box.appendChild(main);

  const meta = document.createElement("div");
  meta.className = "seat-meta";
  const badges = document.createElement("div");
  badges.className = "player-badges";
  const positionMarkers = getPositionMarkers(position);
  if (positionMarkers.length > 0) {
    positionMarkers.forEach(([label, type]) => {
      badges.appendChild(createPositionMarker(label, type));
    });
  } else {
    badges.appendChild(createPositionMarker(String(index + 1), "seat"));
  }
  meta.appendChild(badges);

  const betBadge = document.createElement("span");
  betBadge.className = "seat-bet-badge";
  betBadge.textContent = `Bet ${bet}`;
  meta.appendChild(betBadge);

  const status = document.createElement("p");
  status.className = "seat-status-badge";
  status.textContent = compactStatusLabel || statusLabel;
  meta.appendChild(status);
  box.appendChild(meta);

  return box;
}
