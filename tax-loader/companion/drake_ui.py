#!/usr/bin/env python3
"""
Drake Tax 2025 — UI Automation via pywinauto
============================================
Called by companion.js as a subprocess.
Reads JSON payload from stdin, writes JSON result to stdout.
Stderr is captured by the companion for logging.

Install: pip install pywinauto comtypes

Payload schema (stdin JSON):
{
  "client": {
    "ssn": "XXX-XX-XXXX",         # or "ein" for business
    "first_name": "John",
    "last_name":  "Smith",
    "middle_initial": "",
    "dob": "1985-01-15",           # YYYY-MM-DD
    "filing_status": "2",          # 1=Single 2=MFJ 3=MFS 4=HOH 5=QW
    "address_street": "123 Main",
    "address_city":   "Columbus",
    "address_state":  "OH",
    "address_zip":    "43215"
  },
  "spouse": {                       # optional, for MFJ
    "ssn": "XXX-XX-XXXX",
    "first_name": "Jane",
    "last_name":  "Smith",
    "dob": "1987-03-22"
  },
  "w2s": [
    {
      "ts": "T",                    # T=Taxpayer  S=Spouse
      "employer_ein":   "12-3456789",
      "employer_name":  "Acme Corp",
      "employer_street": "456 Corp Ave",
      "employer_city":   "Columbus",
      "employer_state":  "OH",
      "employer_zip":    "43216",
      "box1_wages":          75000,
      "box2_federal_wh":     12000,
      "box3_ss_wages":       75000,
      "box4_ss_wh":           4650,
      "box5_medicare_wages": 75000,
      "box6_medicare_wh":     1088,
      "box16_state_wages":   75000,
      "box17_state_tax":      3500,
      "box15_state":          "OH"
    }
  ],
  "int_1099s":  [{ "payer_name":"...", "payer_ein":"...", "box1_interest":500 }],
  "div_1099s":  [{ "payer_name":"...", "payer_ein":"...", "box1a_total":1200, "box1b_qualified":900 }],
  "nec_1099s":  [{ "payer_name":"...", "payer_ein":"...", "box1_nec":8000 }],
  "misc_1099s": [{ "payer_name":"...", "payer_ein":"...", "box3_other":500, "box7_nonemployee":0 }],
  "ssa_1099s":  [{ "ts":"T", "box5_net_benefits":18000 }]
}
"""

import sys
import json
import time
import logging
import re

log = logging.getLogger("drake_ui")
logging.basicConfig(stream=sys.stderr, level=logging.INFO,
                    format="%(asctime)s [drake_ui] %(levelname)s %(message)s")

# ── dependency check ──────────────────────────────────────────────────────────
try:
    from pywinauto import Application, Desktop
    from pywinauto.keyboard import send_keys
    from pywinauto.findwindows import ElementNotFoundError
except ImportError:
    sys.stdout.write(json.dumps({
        "ok": False,
        "error": "pywinauto no instalado. Ejecuta: pip install pywinauto comtypes"
    }))
    sys.exit(1)

DRAKE_TITLE_RE   = r"Drake 2025 Tax Software"
DE_TITLE_RE      = r"Drake 2025 - Data Entry.*"
OPEN_DLG_RE      = r"Drake 2025.*Open.*Create.*"
TIMEOUT          = 20   # seconds waiting for windows
FIELD_PAUSE      = 0.07 # seconds between keystrokes

# Stable automation IDs discovered via pywinauto UIA inspection
AID_OPEN_CREATE  = "MainWindow_MenuItemFileOpenReturn"
AID_CALCULATE    = "MainWindow_MenuItemFileCalc"
AID_DE_WINDOW    = "menuScreenWindow"          # the floating Data Entry panel
AID_SCREEN_INNER = "TaxScreenWindow_Window"    # the tab/form inside DE
AID_SEARCH_BOX   = "MenuScreenWindow_TextBoxSearch"

# Stable screen button auto_ids (from UIA inspection — format LINK_0_Col0_SelN)
SCREEN_BUTTON_AIDS = {
    "1":   "LINK_0_Col0_Sel1",    # Name and Address
    "2":   "LINK_0_Col0_Sel2",    # Dependents
    "3":   "LINK_0_Col0_Sel3",    # Income
    "4":   "LINK_0_Col0_Sel4",    # Adjustments
    "W2":  "LINK_0_Col0_Sel10",   # W2 Wages
    "W2G": "LINK_0_Col0_Sel11",   # Gambling
    "1099":"LINK_0_Col0_Sel12",   # 1099-R
    "DIV": "LINK_0_Col0_Sel13",   # 1099-DIV
    "INT": "LINK_0_Col0_Sel14",   # 1099-INT
    "99G": "LINK_0_Col0_Sel15",   # 1099-G
    "99M": "LINK_0_Col0_Sel16",   # 1099-MISC
    "99N": "LINK_0_Col0_Sel17",   # 1099-NEC
    "SSA": "LINK_0_Col0_Sel18",   # SSA-1099
}


# ═══════════════════════════════════════════════════════════════════════════════
class DrakeTaxLoader:
# ═══════════════════════════════════════════════════════════════════════════════

    def __init__(self, payload: dict):
        self.payload    = payload
        self.client     = payload.get("client", {})
        self.spouse     = payload.get("spouse", {})
        raw             = (self.client.get("ssn") or self.client.get("ein") or "")
        self.identifier = raw.replace("-", "").replace(" ", "")
        self.app        = None
        self.main_win   = None
        self._de_handle = None   # cached Win32 HWND of menuScreenWindow (set once, avoids slow UIA lookups)
        self._cached_sb = None   # cached search box UIA element (set once at 1-TSX clean state)

    # ── connection ───────────────────────────────────────────────────────────

    def connect(self):
        """Attach to the running Drake Tax 2025 window."""
        desktop = Desktop(backend="uia")
        wins = desktop.windows(title_re=DRAKE_TITLE_RE)
        if not wins:
            raise RuntimeError(
                "Drake Tax 2025 no está abierto. Ábrelo antes de ejecutar la automatización."
            )
        self.app      = Application(backend="uia").connect(handle=wins[0].handle)
        self.main_win = self.app.window(title_re=DRAKE_TITLE_RE)
        self.main_win.wait("ready", timeout=TIMEOUT)

        # Check for session-lock screen (Drake auto-locks on inactivity)
        import win32gui
        locked_hwnds = []
        def _cb(hwnd, _):
            if win32gui.IsWindowVisible(hwnd):
                t = win32gui.GetWindowText(hwnd)
                if "Drake Tax Security" in t or "Session locked" in t or "session locked" in t:
                    locked_hwnds.append(hwnd)
            return True
        win32gui.EnumWindows(_cb, None)
        if locked_hwnds:
            raise RuntimeError(
                "Drake está bloqueado por sesión (Drake Tax Security). "
                "Ingresa la contraseña en Drake y hacé clic en Login antes de continuar."
            )

        log.info("Conectado a Drake Tax 2025.")

    # ── open / create return ─────────────────────────────────────────────────

    def open_or_create_client(self) -> bool:
        """
        Opens or creates the client's return in Drake.
        If the correct return is already open, uses it directly.
        If a different return is open, closes it first via Alt+F4.
        Returns True when a brand-new return was created.
        """
        if not self.identifier:
            raise ValueError("No se encontró SSN o EIN en el payload.")

        # ── 1. Check if target return is already open ──
        try:
            de = self._de_win()
            title = de.window_text()
            if self.identifier in title.replace("-", "").replace(" ", ""):
                log.info("Return ya abierto para %s. Reutilizando.", self.identifier)
                return False
        except Exception:
            pass  # no DE window open yet

        # ── 2. Close any open DE window (Drake blocks Open/Create while one is open) ──
        try:
            de = self._de_win()
            if de.exists(timeout=0.5):
                log.info("Cerrando return actual para poder abrir el nuevo cliente…")
                de.set_focus()
                time.sleep(0.3)
                # Alt+F4 closes the floating DE window
                send_keys("%{F4}")
                time.sleep(1.5)
                # Dismiss "save?" dialog if Drake prompts
                self._dismiss_post_create_dialogs()
        except Exception:
            pass

        # ── 3. Click Open/Create from main window ──
        self.main_win.set_focus()
        time.sleep(0.6)

        try:
            toolbar = self.main_win.child_window(
                auto_id="MainWindow_ToolBarTop", control_type="ToolBar")
            open_btn = toolbar.child_window(
                auto_id=AID_OPEN_CREATE, control_type="MenuItem")
            open_btn.click_input()
            log.info("Open/Create clickeado.")
        except Exception as e:
            log.warning("Open/Create por auto_id falló (%s) — intentando Ctrl+O", e)
            self.main_win.set_focus()
            time.sleep(0.3)
            send_keys("^o")

        time.sleep(1.5)

        # ── 4. Find the Open/Create dialog ──
        # Drake renders it as a *child Window* of the main window (not top-level).
        # We must search via main_win.descendants(control_type='Window').
        DLG_TITLE_RE = r"Drake 2025 - Open / Create.*"
        dlg = None
        deadline = time.time() + 45   # Drake's dialog can take 20-30s to appear
        while time.time() < deadline:
            try:
                for child in self.main_win.descendants(control_type="Window"):
                    t = child.window_text()
                    if re.search(DLG_TITLE_RE, t, re.IGNORECASE):
                        dlg = child
                        break
            except Exception:
                pass
            if dlg:
                break
            time.sleep(0.8)

        if not dlg:
            raise RuntimeError(
                "El diálogo Open/Create no apareció después de 45s. "
                "Revisá que Drake no tenga diálogos pendientes."
            )

        log.info("Diálogo Open/Create encontrado: %s", dlg.window_text())

        # ── 5. Type SSN/EIN ──
        try:
            edit = dlg.child_window(control_type="Edit")
            edit.set_focus()
            edit.triple_click_input()
            time.sleep(0.2)
            send_keys("^a{DELETE}")
            time.sleep(0.1)
            edit.type_keys(self.identifier, with_spaces=False)
        except Exception:
            send_keys("^a{DELETE}" + self.identifier)

        time.sleep(1.0)

        # ── 6. Determine new vs existing ──
        is_new = True
        try:
            lst = dlg.child_window(control_type="List")
            is_new = lst.item_count() == 0
        except Exception:
            pass

        log.info("Cliente %s — %s", self.identifier,
                 "NUEVO return" if is_new else "return EXISTENTE")

        # ── 7. Confirm ──
        try:
            dlg.child_window(title="OK", control_type="Button").click_input()
        except Exception:
            try:
                dlg.child_window(title="Aceptar", control_type="Button").click_input()
            except Exception:
                send_keys("{ENTER}")

        time.sleep(2.0)
        self._dismiss_post_create_dialogs()

        # ── 8. Wait for DE window to open for our client ──
        deadline = time.time() + 35
        while time.time() < deadline:
            try:
                de = self._de_win()
                de.wait("exists visible", timeout=0.5)
                log.info("Data Entry listo: %s", de.window_text()[:70])
                return is_new
            except Exception:
                pass
            time.sleep(0.8)

        raise RuntimeError(
            "La ventana Data Entry no apareció tras abrir el cliente. "
            "¿Drake requirió interacción manual?"
        )

    def _dismiss_post_create_dialogs(self):
        """Accept/dismiss any dialogs after creating a new return."""
        for _ in range(4):
            try:
                wins = self.app.windows(title_re=r"Drake 2025.*")
                for w in wins:
                    if w.handle == self.main_win.handle:
                        continue
                    if w.exists(timeout=0.5):
                        title = w.window_text()
                        if "data entry" in title.lower():
                            return
                        try:
                            w.child_window(title="OK", control_type="Button").click_input()
                        except Exception:
                            try:
                                w.child_window(title="Aceptar", control_type="Button").click_input()
                            except Exception:
                                send_keys("{ENTER}")
                        time.sleep(0.4)
            except Exception:
                break

    # ── data-entry window helpers ─────────────────────────────────────────────

    def _de_win(self):
        """Get the Data Entry panel (always a child of main Drake window)."""
        return self.main_win.child_window(auto_id=AID_DE_WINDOW, control_type="Window")

    def _de_hwnd(self) -> int:
        """
        Return the Win32 HWND of the DE container (menuScreenWindow).

        Caches the value after the first call so subsequent calls are instant
        (no UIA traversal). Calling self._de_win().handle triggers a full UIA
        tree walk of the main window — this takes 10-12 s when 3+ TSX are
        open because Drake's .NET UIA provider is under load, and repeating it
        inside tight loops (e.g. _go_screen_menu) stalls the entire provider.
        """
        if self._de_handle is None:
            self._de_handle = self._de_win().handle
            log.info("_de_hwnd: cached DE hwnd=%d", self._de_handle)
        return self._de_handle

    def _tsx_count(self) -> int:
        """
        Count TaxScreenWindows owned by the DE container via Win32 GW_OWNER.
        1 = Screen Menu only (clean state). 2+ = extra forms open.
        Instant and never hangs (no UIA traversal).
        """
        import win32gui, win32con
        try:
            de_hwnd = self._de_hwnd()
            count = 0
            def _cb(hwnd, _):
                nonlocal count
                if (win32gui.GetWindow(hwnd, win32con.GW_OWNER) == de_hwnd
                        and win32gui.IsWindowVisible(hwnd)):
                    count += 1
                return True
            win32gui.EnumWindows(_cb, None)
            return count
        except Exception:
            return -1

    def _children_safe(self, ctrl, timeout: float = 4.0):
        """
        Call ctrl.children() with a thread timeout.
        Returns the list of children, or None if the call timed out (UIA hang).
        Used instead of bare de.children() to avoid blocking when W2 or complex
        forms are in Drake's navigation stack.
        """
        import threading
        result = [None]

        def _run():
            try:
                result[0] = ctrl.children()
            except Exception:
                result[0] = []

        t = threading.Thread(target=_run, daemon=True)
        t.start()
        t.join(timeout=timeout)
        return result[0]   # None = timed-out (hung); [] = error; list = OK

    def _close_top_form_win32(self) -> bool:
        """
        Close the topmost open form inside Drake's DE window via Win32 WM_CLOSE.
        Zero UIA traversal — never hangs regardless of what Drake is displaying.

        Architecture note (discovered via inspection):
        Drake's TaxScreenWindow_Window elements are OWNED top-level Win32 windows
        (GetWindow(hwnd, GW_OWNER) == de_hwnd), NOT child windows (GetParent).
        We must enumerate via EnumWindows + GW_OWNER, then close the Z-topmost.

        Returns True if an owned form window was found and closed.
        """
        import win32gui
        import win32con
        try:
            de_hwnd = self._de_hwnd()   # cached Win32 HWND, no UIA traversal
            log.debug("_close_top_form_win32: de_hwnd=%d", de_hwnd)

            # Collect all top-level windows owned by the DE container
            owned = []
            def _enum_cb(hwnd, _):
                if (win32gui.GetWindow(hwnd, win32con.GW_OWNER) == de_hwnd
                        and win32gui.IsWindowVisible(hwnd)):
                    owned.append(hwnd)
                return True
            win32gui.EnumWindows(_enum_cb, None)

            log.debug("_close_top_form_win32: owned=%s", owned)
            if not owned:
                log.warning("_close_top_form_win32: no owned TaxScreenWindow found")
                return False

            if len(owned) == 1:
                # Only Screen Menu — nothing to close
                log.info("_close_top_form_win32: only 1 owned window (Screen Menu); skipping")
                return False

            # Find the topmost owned window in Z-order:
            # Walk from the global top (GetTopWindow) downward; first match = active form.
            top_hwnd = win32gui.GetTopWindow(0)
            while top_hwnd:
                if top_hwnd in owned:
                    win32gui.PostMessage(top_hwnd, win32con.WM_CLOSE, 0, 0)
                    log.info("_close_top_form_win32: WM_CLOSE → hwnd=%d (Z-topmost owned)",
                             top_hwnd)
                    time.sleep(0.9)
                    return True
                top_hwnd = win32gui.GetWindow(top_hwnd, win32con.GW_HWNDNEXT)

            # Fallback: just close the first in the list
            win32gui.PostMessage(owned[0], win32con.WM_CLOSE, 0, 0)
            log.info("_close_top_form_win32: WM_CLOSE → hwnd=%d (fallback first-owned)",
                     owned[0])
            time.sleep(0.9)
            return True
        except Exception as e:
            log.error("_close_top_form_win32 error: %s", e)
            return False

    def _go_screen_menu(self):
        """
        Return to the Screen Menu from any open form.

        Strategy: close forms one-by-one via Win32 WM_CLOSE until only the
        Screen Menu TaxScreenWindow_Window remains (tsx == 1).

        Why Win32 instead of UIA/keyboard:
        - de.child_window() hangs once any form is open (deep UIA traversal)
        - de.children() hangs when W2 or complex forms are in the stack (3+ TSX)
        - {ESC} is a no-op — Drake ignores it inside forms
        - Win32 WM_CLOSE on the form HWND works without touching UIA
        """
        for attempt in range(6):   # safety: max 5 forms to close
            tsx = self._tsx_count()
            if tsx == 1:
                log.info("_go_screen_menu: at Screen Menu (attempt %d)", attempt)
                return
            # tsx == -1 means de.children() timed out (complex form like W2 is open)
            log.info("_go_screen_menu: tsx=%d (attempt %d), closing top form via Win32",
                     tsx, attempt)
            self._close_top_form_win32()
            time.sleep(0.5)   # let Drake process the close before re-checking
        log.warning("_go_screen_menu: still not at Screen Menu after 6 attempts")

    def _focus_form(self):
        """Click the inner TaxScreenWindow to ensure keyboard focus is on the form, not the search box."""
        try:
            de = self._de_win()
            inner = de.child_window(auto_id=AID_SCREEN_INNER, control_type="Window")
            inner.click_input()
            time.sleep(0.3)
        except Exception:
            try:
                de = self._de_win()
                de.click_input()
                time.sleep(0.2)
            except Exception:
                pass

    def _get_screen1_form_ctrls(self, auto_ids: list) -> dict:
        """
        Find Screen 1 controls via IUIAutomation.ElementFromHandle on the topmost
        owned TaxScreenWindow + FindFirst(TreeScope_Descendants=4) per field.

        Called on the MAIN thread — COM is already initialized; no background thread
        needed (FindFirst on a single TSX window is instantaneous, no hang risk).
        Background threads fail silently on COM calls because Python threads don't
        call CoInitialize, so cross-apartment calls deadlock with no message pump.
        """
        import win32gui, win32con
        from pywinauto.uia_defines import IUIA
        from pywinauto.uia_element_info import UIAElementInfo
        from pywinauto.base_wrapper import BaseWrapper

        result: dict = {}
        try:
            de_hwnd = self._de_hwnd()

            # Step 1: topmost owned TaxScreenWindow (Screen 1 is most-recently opened)
            owned = []
            def _enum_cb(hwnd, _):
                if (win32gui.GetWindow(hwnd, win32con.GW_OWNER) == de_hwnd
                        and win32gui.IsWindowVisible(hwnd)):
                    owned.append(hwnd)
                return True
            win32gui.EnumWindows(_enum_cb, None)

            top_tsx_hwnd = None
            h = win32gui.GetTopWindow(0)
            while h:
                if h in owned:
                    top_tsx_hwnd = h
                    break
                h = win32gui.GetWindow(h, win32con.GW_HWNDNEXT)

            if top_tsx_hwnd is None:
                log.warning("_get_screen1_form_ctrls: no owned TaxScreenWindow")
                return result

            log.info("_get_screen1_form_ctrls: Screen 1 hwnd=%d", top_tsx_hwnd)

            # Step 2: UIA element via HWND (no tree traversal from DE root)
            iuia_client = IUIA().iuia
            tsx_elem = iuia_client.ElementFromHandle(top_tsx_hwnd)
            if tsx_elem is None:
                log.warning("_get_screen1_form_ctrls: ElementFromHandle returned None")
                return result

            # Step 3: FindFirst(Descendants) per field — fast, no hang
            for aid in auto_ids:
                try:
                    cond  = iuia_client.CreatePropertyCondition(30011, aid)
                    found = tsx_elem.FindFirst(4, cond)  # 4 = TreeScope_Descendants
                    if found is not None:
                        result[aid] = BaseWrapper(UIAElementInfo(found), "uia")
                except Exception as e:
                    log.warning("_get_screen1_form_ctrls FindFirst(%s): %s", aid, e)

        except Exception as e:
            log.warning("_get_screen1_form_ctrls error: %s", e)

        missing = set(auto_ids) - set(result)
        if missing:
            log.warning("_get_screen1_form_ctrls: not found: %s", sorted(missing))
        log.info("_get_screen1_form_ctrls: found %d/%d", len(result), len(auto_ids))
        return result

    def _get_screen1_ctrl(self, auto_id: str):
        """Single-field wrapper around _get_screen1_form_ctrls (kept for compatibility)."""
        result = self._get_screen1_form_ctrls([auto_id])
        return result.get(auto_id)

    def _activate_top_form(self):
        """
        Give Win32 keyboard focus to the topmost owned TaxScreenWindow.

        After search-box navigation (sb.set_focus → type → Enter), Drake opens
        the new form but keyboard focus remains on the search box (inside the DE
        container). All subsequent send_keys() calls go to the search box instead
        of the form. This method finds the topmost owned form window and calls
        SetForegroundWindow to transfer keyboard focus to it.

        Called at the end of every _navigate_to_screen() call, AFTER
        _fix_offscreen_tsx() repositions any off-screen form.
        """
        import win32gui
        import win32con
        try:
            de_hwnd = self._de_hwnd()
            owned = []
            def _enum_cb(hwnd, _):
                if (win32gui.GetWindow(hwnd, win32con.GW_OWNER) == de_hwnd
                        and win32gui.IsWindowVisible(hwnd)):
                    owned.append(hwnd)
                return True
            win32gui.EnumWindows(_enum_cb, None)

            if len(owned) <= 1:
                log.debug("_activate_top_form: only Screen Menu (1 owned), nothing to focus")
                return

            # Find topmost in Z-order and activate it
            top_hwnd = win32gui.GetTopWindow(0)
            while top_hwnd:
                if top_hwnd in owned:
                    win32gui.SetForegroundWindow(top_hwnd)
                    log.info("_activate_top_form: SetForegroundWindow hwnd=%d", top_hwnd)
                    time.sleep(0.3)
                    return
                top_hwnd = win32gui.GetWindow(top_hwnd, win32con.GW_HWNDNEXT)

            # Fallback: just activate the first owned (not Screen Menu)
            # Screen Menu is typically the LAST in owned (opened first = lowest Z)
            win32gui.SetForegroundWindow(owned[0])
            log.info("_activate_top_form: SetForegroundWindow hwnd=%d (fallback)", owned[0])
            time.sleep(0.3)
        except Exception as e:
            log.warning("_activate_top_form error: %s", e)

    def _fix_offscreen_tsx(self):
        """
        After a search-box navigation, Drake sometimes opens the new
        TaxScreenWindow at Y≈10000 (off-screen).  Find the topmost owned
        TaxScreenWindow that's clearly off-screen and move it to the same
        position as the DE container window.

        Architecture: TaxScreenWindow_Window elements are owned top-level
        Win32 windows (GW_OWNER == de_hwnd). We enumerate them, check rect,
        and use SetWindowPos to reposition off-screen ones.
        """
        import win32gui
        import win32con
        try:
            de_hwnd = self._de_hwnd()
            de_rect = win32gui.GetWindowRect(de_hwnd)  # (L, T, R, B)

            owned = []
            def _enum_cb(hwnd, _):
                if (win32gui.GetWindow(hwnd, win32con.GW_OWNER) == de_hwnd
                        and win32gui.IsWindowVisible(hwnd)):
                    owned.append(hwnd)
                return True
            win32gui.EnumWindows(_enum_cb, None)

            for hwnd in owned:
                rect = win32gui.GetWindowRect(hwnd)
                # Off-screen if top edge is below 3000 px or above -1000 px
                if rect[1] > 3000 or rect[1] < -1000:
                    new_x = de_rect[0]
                    new_y = de_rect[1]
                    new_w = de_rect[2] - de_rect[0]
                    new_h = de_rect[3] - de_rect[1]
                    win32gui.SetWindowPos(
                        hwnd, win32con.HWND_TOP,
                        new_x, new_y, new_w, new_h,
                        win32con.SWP_SHOWWINDOW)
                    log.info("_fix_offscreen_tsx: moved hwnd=%d from %s to %s",
                             hwnd, rect, (new_x, new_y, new_w, new_h))
        except Exception as e:
            log.warning("_fix_offscreen_tsx error: %s", e)

    def _find_sb_findirst(self):
        """
        Find the search box via IUIAutomation.FindFirst(TreeScope_Children=2).

        de.children() calls IUIAutomation.GetChildren() which recurses into
        TaxScreenWindow_Window's subtree and blocks when a Drake override field
        (e.g., Preparer #) has focus+invalid state.

        FindFirst(TreeScope_Children) only checks each DIRECT child's AutomationId
        property — no subtree recursion — so it finds the search box without
        triggering the provider hang.  Wrapped in a thread timeout as safety net.
        """
        import threading
        result = [None]

        def _run():
            try:
                from pywinauto.uia_defines import IUIA
                from pywinauto.uia_element_info import UIAElementInfo
                from pywinauto.base_wrapper import BaseWrapper

                de      = self._de_win()
                de_info = de.element_info        # UIAElementInfo
                de_elem = de_info.element        # raw IUIAutomationElement COM object

                iuia_client = IUIA().iuia
                # UIA_AutomationIdPropertyId = 30011
                cond  = iuia_client.CreatePropertyCondition(30011, AID_SEARCH_BOX)
                found = de_elem.FindFirst(2, cond)   # 2 = TreeScope_Children
                if found is not None:
                    result[0] = BaseWrapper(UIAElementInfo(found), "uia")
                    log.info("_find_sb_findirst: search box found via FindFirst(Children)")
            except Exception as e:
                log.warning("_find_sb_findirst error: %s", e)

        t = threading.Thread(target=_run, daemon=True)
        t.start()
        t.join(timeout=6.0)
        return result[0]   # None = not found / timed out

    def _navigate_to_screen(self, code: str) -> bool:
        """
        Navigate to a Drake screen by code (e.g. '1', 'W2', 'INT').

        Key insight: de.children() hangs after fill_screen1() types data into
        a form (even at 2 TSX). The search box element itself is still valid —
        only the enumeration hangs. Solution: cache the search box UIA element
        reference once (at the clean 1-TSX start state) and reuse it for ALL
        subsequent navigations, bypassing de.children() completely.

        If no cache exists yet, try to populate it via _children_safe().
        """
        de = self._de_win()

        # ── Try to use or populate the cached search box reference ──────────
        if self._cached_sb is None:
            # de.children() hangs in two situations:
            #   (a) 2+ TSX — any open form in the nav stack (Screen 1, W2, etc.)
            #   (b) 1 TSX with a yellow/invalid override field (Preparer #, etc.)
            #
            # Strategy:
            #   1. _go_screen_menu(): close all extra forms via Win32 WM_CLOSE → 1 TSX
            #   2. 2-second wait for Drake to process the WM_CLOSE events
            #   3. Send ESC+TAB to the Screen Menu owned window to defocus any
            #      yellow override field (keys MUST go to the owned TaxScreenWindow,
            #      not to de.handle; the container doesn't route keys to owned forms)
            #   4. ONE _children_safe call with a 20-second timeout — enough time
            #      for Drake to respond at a clean 1-TSX state.
            #      We use only ONE background thread here. Multiple short-timeout
            #      threads accumulate as undead COM threads (Python can't kill them),
            #      which prevents clean process exit and corrupts COM state.
            import win32gui, win32con

            # Step 1 ── close open forms → 1 TSX
            log.info("_navigate_to_screen: _go_screen_menu() → 1 TSX")
            self._go_screen_menu()
            time.sleep(2.0)   # Drake needs time to process WM_CLOSE events

            de_hwnd = self._de_hwnd()

            # Step 2 ── find Screen Menu owned window and defocus any yellow override
            owned_set = set()
            def _enum_cb(hwnd, _):
                if (win32gui.GetWindow(hwnd, win32con.GW_OWNER) == de_hwnd
                        and win32gui.IsWindowVisible(hwnd)):
                    owned_set.add(hwnd)
                return True
            win32gui.EnumWindows(_enum_cb, None)

            # Lowest Z-order owned window = Screen Menu (opened first, at bottom)
            screen_menu_hwnd = de_hwnd
            h = win32gui.GetTopWindow(0)
            lowest = None
            while h:
                if h in owned_set:
                    lowest = h   # keep updating; last one found = lowest Z-order
                h = win32gui.GetWindow(h, win32con.GW_HWNDNEXT)
            if lowest:
                screen_menu_hwnd = lowest

            log.info("_navigate_to_screen: sending ESC+TAB to Screen Menu hwnd=%d "
                     "(owned count=%d)", screen_menu_hwnd, len(owned_set))
            try:
                win32gui.SetForegroundWindow(screen_menu_hwnd)
                time.sleep(0.25)
                send_keys("{ESC}")    # reset override to default value
                time.sleep(0.15)
                send_keys("{TAB}")    # move focus off override field
                time.sleep(0.2)
            except Exception as e:
                log.warning("ESC+TAB to Screen Menu failed: %s", e)

            # Step 3 ── ONE de.children() call with a generous 20-second timeout.
            # At clean 1-TSX state, Drake responds in <5 seconds.
            # Only one background thread is created to avoid undead-thread accumulation.
            log.info("_navigate_to_screen: _children_safe(timeout=20s) …")
            kids = self._children_safe(de, timeout=20.0)

            if kids is not None:
                self._cached_sb = next(
                    (c for c in kids
                     if c.element_info.automation_id == AID_SEARCH_BOX), None)
                if self._cached_sb is None:
                    log.warning("_navigate_to_screen: search box not in de.children() "
                                "(%d kids) — cannot navigate to %s", len(kids), code)
                    return False
                log.info("_navigate_to_screen: search box cached (hwnd=%s)",
                         getattr(self._cached_sb, 'handle', 'UIA-only'))
            else:
                log.warning("_navigate_to_screen: de.children() timed out (20s) even "
                            "after _go_screen_menu + ESC+TAB — cannot navigate to %s", code)
                return False

        sb = self._cached_sb

        # ── Use the cached (or freshly obtained) search box ──────────────────
        # set_focus() calls UIA's IUIAutomationElement.SetFocus() directly —
        # no screen-coordinate mapping, no DPI issues, no tree traversal.
        # Works even when de.children() hangs due to a dirty form.
        try:
            sb.set_focus()
            time.sleep(0.25)
            send_keys("^a{DELETE}")
            time.sleep(0.08)
            send_keys(code.upper())
            send_keys("{ENTER}")
            time.sleep(1.2)
            self._fix_offscreen_tsx()   # move any newly-opened form from Y≈10000 to visible area
            self._activate_top_form()   # give keyboard focus to the newly-opened form
            log.info("Navegado a screen %s via search box (cached)", code)
            return True
        except Exception as e:
            log.warning("_navigate_to_screen(%s) via cached sb failed: %s — "
                        "invalidating cache", code, e)
            self._cached_sb = None   # force re-fetch on next call

        log.error("No se pudo navegar a screen '%s'", code)
        return False

    # ── low-level field helpers ───────────────────────────────────────────────

    @staticmethod
    def _esc_special(text: str) -> str:
        """Escape pywinauto special chars { } + ^ % ~ in type_keys."""
        for ch in ("^", "%", "~", "+"):
            text = text.replace(ch, "{" + ch + "}")
        text = text.replace("{", "{{").replace("}", "}}")
        return text

    def _clear_type_tab(self, value):
        """Clear focused field, type value (or empty), Tab to next."""
        if value is not None and str(value).strip() not in ("", "0"):
            send_keys("^a{DELETE}")
            time.sleep(FIELD_PAUSE)
            send_keys(self._esc_special(str(value)), with_spaces=True)
        send_keys("{TAB}")
        time.sleep(FIELD_PAUSE)

    def _skip(self, n: int = 1):
        """Tab past n fields without editing."""
        for _ in range(n):
            send_keys("{TAB}")
            time.sleep(FIELD_PAUSE)

    def _select_combo(self, value: str):
        """Type value into a combo / dropdown (Drake accepts typing first letters)."""
        if value:
            send_keys(self._esc_special(str(value)))
        send_keys("{TAB}")
        time.sleep(FIELD_PAUSE)

    # ── Screen 1 – Name, Address & General Information ────────────────────────

    # Screen 1 field auto_ids (discovered via UIA inspection of ucTaxForm):
    # Taxpayer group (Frame_81):
    #   Dropdown_1=filing_status  Textbox_2=ssn(read-only)
    #   Textbox_3=first  Textbox_4=MI  Textbox_5=last  Dropdown_6=suffix
    #   Textbox_7=dob  Textbox_8=dod  Textbox_9=occupation
    #   Textbox_10..15=phone/ext(×3)  DropdownOverride_16=print_on_return
    #   Textbox_17=fax  Textbox_18=email
    #   CheckboxTextRight_19..22  Dropdown_23=not_live_with_spouse
    # Spouse group (Frame_82):
    #   Textbox_24=ssn  Textbox_25=first  Textbox_26=MI  TextboxOverride_27=last
    #   Dropdown_28=suffix  Textbox_29=dob  ... (mirrors taxpayer)
    # Mailing Address group (Frame_78):
    #   Textbox_50=street  Textbox_51=apt  Textbox_52=city
    #   Dropdown_53=state  Textbox_54=zip  Textbox_55=county
    # Standalone: Textbox_49=in_care_of

    def fill_screen1(self):
        """
        Fill Screen 1 via direct UIA auto_id field access.

        Optimization: collect ALL needed controls in ONE UIA traversal
        (_get_screen1_form_ctrls) BEFORE any typing starts.  A single traversal
        takes ~3-5 s; the old approach called de.children() once per field
        (~8 s × 10 fields = ~80 s).  After any field is typed Drake's UIA tree
        becomes 'dirty' and de.children() would start to hang — collecting
        upfront avoids that race completely.
        """
        p  = self.client
        sp = self.spouse
        if not self._navigate_to_screen("1"):
            raise RuntimeError("No se pudo navegar a screen 1")
        time.sleep(0.5)

        # ── Build list of auto_ids we need ──────────────────────────────────
        needed = ["Dropdown_1",       # filing status
                  "Textbox_3",        # taxpayer first name
                  "Textbox_4",        # taxpayer MI
                  "Textbox_5",        # taxpayer last name
                  "Textbox_7",        # taxpayer DOB
                  "Textbox_50",       # street
                  "Textbox_52",       # city
                  "Dropdown_53",      # state
                  "Textbox_54"]       # ZIP
        if sp.get("ssn"):
            needed += ["Textbox_24",         # spouse SSN
                       "Textbox_25",         # spouse first name
                       "Textbox_26",         # spouse MI
                       "TextboxOverride_27", # spouse last name
                       "Textbox_29"]         # spouse DOB

        # ONE traversal — all controls cached before any typing
        ctrls = self._get_screen1_form_ctrls(needed)
        if not ctrls:
            raise RuntimeError("Screen 1: UIA traversal returned no controls")

        def _fill(auto_id, value, is_combo=False):
            if value is None or str(value).strip() in ("", "0"):
                return
            ctrl = ctrls.get(auto_id)
            if ctrl is None:
                log.warning("Screen 1 field '%s' not found — skipping", auto_id)
                return
            try:
                # set_focus() calls IUIAutomationElement.SetFocus() directly —
                # no screen-coordinate mapping, no DPI scaling issues.
                # click_input() had a DPI bug that caused accidental clicks on
                # the Preparer# override dropdown, putting it in yellow/invalid
                # state and blocking de.children() for all subsequent calls.
                ctrl.set_focus()
                time.sleep(0.08)
                send_keys("^a{DELETE}")
                time.sleep(0.05)
                if is_combo:
                    send_keys(self._esc_special(str(value)))
                else:
                    send_keys(self._esc_special(str(value)), with_spaces=True)
                send_keys("{TAB}")
                time.sleep(FIELD_PAUSE)
            except Exception as e:
                log.warning("Screen 1 fill '%s' error: %s", auto_id, e)

        # ── Filing status ──
        _fill("Dropdown_1", str(p.get("filing_status", "1")), is_combo=True)

        # ── Taxpayer name & DOB ──
        _fill("Textbox_3", p.get("first_name", ""))
        _fill("Textbox_4", p.get("middle_initial", ""))
        _fill("Textbox_5", p.get("last_name", ""))
        _fill("Textbox_7", self._format_dob(p.get("dob", "")))

        # ── Spouse (if MFJ) ──
        if sp.get("ssn"):
            ssn_clean = sp["ssn"].replace("-", "").replace(" ", "")
            _fill("Textbox_24", ssn_clean)
            _fill("Textbox_25", sp.get("first_name", ""))
            _fill("Textbox_26", sp.get("middle_initial", ""))
            _fill("TextboxOverride_27", sp.get("last_name", ""))
            _fill("Textbox_29", self._format_dob(sp.get("dob", "")))

        # ── Mailing Address ──
        _fill("Textbox_50", p.get("address_street", ""))
        _fill("Textbox_52", p.get("address_city", ""))
        _fill("Dropdown_53", p.get("address_state", ""), is_combo=True)
        _fill("Textbox_54", p.get("address_zip", ""))

        log.info("Screen 1 completado.")

    @staticmethod
    def _format_dob(dob: str) -> str:
        """Convert YYYY-MM-DD → MM-DD-YYYY for Drake date fields."""
        if not dob:
            return ""
        parts = dob.replace("/", "-").split("-")
        if len(parts) == 3 and len(parts[0]) == 4:
            return f"{parts[1]}-{parts[2]}-{parts[0]}"
        return dob

    # ── W2 ────────────────────────────────────────────────────────────────────

    # W2 field auto_ids (discovered via UIA inspection of ucTaxForm in W2 window):
    # Dropdown_1=ts  Textbox_4=ein  Textbox_5=name  Textbox_6=name_cont
    # Textbox_7=street  Textbox_8=city  Dropdown_9=state  Textbox_10=zip
    # Employee section: TextboxOverride_14=emp_first  TextboxOverride_15=emp_last
    #   TextboxOverride_16=emp_street  TextboxOverride_17=emp_city
    #   DropdownOverride_18=emp_state  TextboxOverride_19=emp_zip
    # Boxes: Textbox_23=box1  Textbox_24=box2  Textbox_25=box3  Textbox_26=box4
    #        Textbox_27=box5  Textbox_28=box6
    # State (row 1): Dropdown_57=box15_state  Textbox_58=box15_ein
    #                Textbox_59=box16  Textbox_60=box17

    def fill_w2(self, w2: dict, index: int = 0):
        """
        Fill one W2 record using direct UIA field access (same approach as fill_screen1).

        Why UIA instead of tab navigation:
          Tab-navigation relied on Drake's state-combo auto-advance behavior.
          When the combo did NOT auto-advance, subsequent fields received wrong
          values (employer_city ended up in ZIP field). Direct UIA is explicit:
          each field is targeted by auto_id regardless of focus or tab order.
        """
        if not self._navigate_to_screen("W2"):
            raise RuntimeError("No se pudo navegar a screen W2")

        time.sleep(0.3)

        if index > 0:
            send_keys("{F3}")   # New record in Drake
            time.sleep(0.8)

        # ── Collect all needed W2 controls in ONE traversal ──────────────────
        needed = [
            "Dropdown_1",   # TS (T/S)
            "Textbox_4",    # EIN
            "Textbox_5",    # Employer Name
            "Textbox_7",    # Street
            "Textbox_8",    # City
            "Dropdown_9",   # Employer State
            "Textbox_10",   # ZIP
            "Textbox_23",   # Box 1 Wages
            "Textbox_24",   # Box 2 Federal WH
            "Textbox_25",   # Box 3 SS Wages
            "Textbox_26",   # Box 4 SS WH
            "Textbox_27",   # Box 5 Medicare Wages
            "Textbox_28",   # Box 6 Medicare WH
            "Dropdown_57",  # Box 15 State
            "Textbox_59",   # Box 16 State Wages
            "Textbox_60",   # Box 17 State Tax
        ]

        ctrls = self._get_screen1_form_ctrls(needed)
        if not ctrls:
            raise RuntimeError("W2: UIA traversal returned no controls")

        def _fill(auto_id, value, is_combo=False):
            if value is None or str(value).strip() in ("", "0"):
                return
            ctrl = ctrls.get(auto_id)
            if ctrl is None:
                log.warning("W2 field '%s' not found — skipping", auto_id)
                return
            try:
                ctrl.set_focus()
                time.sleep(0.08)
                send_keys("^a{DELETE}")
                time.sleep(0.05)
                if is_combo:
                    send_keys(self._esc_special(str(value)))
                else:
                    send_keys(self._esc_special(str(value)), with_spaces=True)
                send_keys("{TAB}")
                time.sleep(FIELD_PAUSE)
            except Exception as e:
                log.warning("W2 fill '%s' error: %s", auto_id, e)

        ts = "T" if str(w2.get("ts", "T")).upper() == "T" else "S"
        _fill("Dropdown_1", ts, is_combo=True)

        ein = str(w2.get("employer_ein", "")).replace("-", "")
        _fill("Textbox_4", ein)
        _fill("Textbox_5", w2.get("employer_name", ""))
        _fill("Textbox_7", w2.get("employer_street", ""))
        _fill("Textbox_8", w2.get("employer_city", ""))
        _fill("Dropdown_9", w2.get("employer_state", ""), is_combo=True)
        _fill("Textbox_10", w2.get("employer_zip", ""))

        _fill("Textbox_23", w2.get("box1_wages"))
        _fill("Textbox_24", w2.get("box2_federal_wh"))
        _fill("Textbox_25", w2.get("box3_ss_wages"))
        _fill("Textbox_26", w2.get("box4_ss_wh"))
        _fill("Textbox_27", w2.get("box5_medicare_wages"))
        _fill("Textbox_28", w2.get("box6_medicare_wh"))

        _fill("Dropdown_57", w2.get("box15_state", ""), is_combo=True)
        _fill("Textbox_59", w2.get("box16_state_wages"))
        _fill("Textbox_60", w2.get("box17_state_tax"))

        log.info("W2 %d completado — empleador: %s", index + 1,
                 w2.get("employer_name", "?"))

    # ── 1099-INT ──────────────────────────────────────────────────────────────

    def fill_1099_int(self, data: dict, index: int = 0):
        if not self._navigate_to_screen("INT"):
            raise RuntimeError("No se pudo navegar a screen INT")
        if index > 0:
            send_keys("{F3}")
            time.sleep(0.5)
        # Payer name, EIN, Box 1 interest, Box 3 interest (US bonds), Box 4 fed WH
        self._clear_type_tab(data.get("payer_name", ""))
        self._clear_type_tab(data.get("payer_ein", ""))
        self._clear_type_tab(data.get("box1_interest") or data.get("amount"))
        self._clear_type_tab(data.get("box3_interest", ""))
        self._clear_type_tab(data.get("box4_federal_wh", ""))
        log.info("1099-INT %d completado — pagador: %s", index + 1,
                 data.get("payer_name", "?"))

    # ── 1099-DIV ─────────────────────────────────────────────────────────────

    def fill_1099_div(self, data: dict, index: int = 0):
        if not self._navigate_to_screen("DIV"):
            raise RuntimeError("No se pudo navegar a screen DIV")
        if index > 0:
            send_keys("{F3}")
            time.sleep(0.5)
        self._clear_type_tab(data.get("payer_name", ""))
        self._clear_type_tab(data.get("payer_ein", ""))
        self._clear_type_tab(data.get("box1a_total_dividends") or data.get("amount"))
        self._clear_type_tab(data.get("box1b_qualified_dividends", ""))
        self._clear_type_tab(data.get("box4_federal_wh", ""))
        log.info("1099-DIV %d completado — pagador: %s", index + 1,
                 data.get("payer_name", "?"))

    # ── 1099-NEC ─────────────────────────────────────────────────────────────

    def fill_1099_nec(self, data: dict, index: int = 0):
        if not self._navigate_to_screen("99N"):
            raise RuntimeError("No se pudo navegar a screen 99N")
        if index > 0:
            send_keys("{F3}")
            time.sleep(0.5)
        self._clear_type_tab(data.get("payer_name", ""))
        self._clear_type_tab(data.get("payer_ein", ""))
        self._clear_type_tab(data.get("box1_nec") or data.get("amount"))
        self._clear_type_tab(data.get("box4_federal_wh", ""))
        log.info("1099-NEC %d completado — pagador: %s", index + 1,
                 data.get("payer_name", "?"))

    # ── 1099-MISC ────────────────────────────────────────────────────────────

    def fill_1099_misc(self, data: dict, index: int = 0):
        if not self._navigate_to_screen("99M"):
            raise RuntimeError("No se pudo navegar a screen 99M")
        if index > 0:
            send_keys("{F3}")
            time.sleep(0.5)
        self._clear_type_tab(data.get("payer_name", ""))
        self._clear_type_tab(data.get("payer_ein", ""))
        self._clear_type_tab(data.get("box3_other_income", ""))
        self._clear_type_tab(data.get("box4_federal_wh", ""))
        log.info("1099-MISC %d completado — pagador: %s", index + 1,
                 data.get("payer_name", "?"))

    # ── SSA-1099 ─────────────────────────────────────────────────────────────

    def fill_ssa(self, data: dict, index: int = 0):
        if not self._navigate_to_screen("SSA"):
            raise RuntimeError("No se pudo navegar a screen SSA")
        if index > 0:
            send_keys("{F3}")
            time.sleep(0.5)
        # TS (Taxpayer/Spouse)
        ts = "T" if str(data.get("ts", "T")).upper() == "T" else "S"
        self._select_combo(ts)
        # Box 5 net benefits
        self._clear_type_tab(data.get("box5_net_benefits") or data.get("amount"))
        log.info("SSA-1099 %d completado.", index + 1)

    # ── Calculate ────────────────────────────────────────────────────────────

    def calculate(self):
        try:
            self.main_win.set_focus()
            time.sleep(0.3)
            toolbar = self.main_win.child_window(
                auto_id="MainWindow_ToolBarTop", control_type="ToolBar")
            calc_btn = toolbar.child_window(auto_id=AID_CALCULATE, control_type="MenuItem")
            calc_btn.click_input()
            time.sleep(2.5)
            log.info("Return calculado.")
        except Exception as e:
            log.warning("No se pudo calcular automáticamente: %s", e)

    # ── main entry point ─────────────────────────────────────────────────────

    def run(self) -> dict:
        screens_filled: list[str] = []
        warnings:       list[str] = []
        errors:         list[str] = []

        # Connect
        try:
            self.connect()
        except Exception as e:
            return {"ok": False, "error": str(e),
                    "screens_filled": [], "warnings": [], "errors": [str(e)]}

        # Open / create client
        try:
            is_new = self.open_or_create_client()
        except Exception as e:
            return {"ok": False, "error": f"No se pudo abrir/crear el cliente: {e}",
                    "screens_filled": [], "warnings": [], "errors": [str(e)]}

        # Screen 1
        personal = self.client
        if any(personal.get(k) for k in ("first_name", "last_name", "address_street")):
            try:
                self.fill_screen1()
                screens_filled.append("screen_1")
            except Exception as e:
                errors.append(f"Screen 1: {e}")

        # W2s
        for i, w2 in enumerate(self.payload.get("w2s", [])):
            try:
                self.fill_w2(w2, i)
                screens_filled.append(f"w2_{i + 1}")
            except Exception as e:
                errors.append(f"W2 #{i + 1}: {e}")

        # 1099-INT
        for i, item in enumerate(self.payload.get("int_1099s", [])):
            try:
                self.fill_1099_int(item, i)
                screens_filled.append(f"int_1099_{i + 1}")
            except Exception as e:
                errors.append(f"1099-INT #{i + 1}: {e}")

        # 1099-DIV
        for i, item in enumerate(self.payload.get("div_1099s", [])):
            try:
                self.fill_1099_div(item, i)
                screens_filled.append(f"div_1099_{i + 1}")
            except Exception as e:
                errors.append(f"1099-DIV #{i + 1}: {e}")

        # 1099-NEC
        for i, item in enumerate(self.payload.get("nec_1099s", [])):
            try:
                self.fill_1099_nec(item, i)
                screens_filled.append(f"nec_1099_{i + 1}")
            except Exception as e:
                errors.append(f"1099-NEC #{i + 1}: {e}")

        # 1099-MISC
        for i, item in enumerate(self.payload.get("misc_1099s", [])):
            try:
                self.fill_1099_misc(item, i)
                screens_filled.append(f"misc_1099_{i + 1}")
            except Exception as e:
                errors.append(f"1099-MISC #{i + 1}: {e}")

        # SSA-1099
        for i, item in enumerate(self.payload.get("ssa_1099s", [])):
            try:
                self.fill_ssa(item, i)
                screens_filled.append(f"ssa_1099_{i + 1}")
            except Exception as e:
                errors.append(f"SSA-1099 #{i + 1}: {e}")

        # Calculate
        if screens_filled:
            try:
                self.calculate()
            except Exception as e:
                warnings.append(f"Auto-calculate falló: {e}")

        return {
            "ok":             len(errors) == 0,
            "client_created": is_new,
            "identifier":     self.identifier,
            "screens_filled": screens_filled,
            "warnings":       warnings,
            "errors":         errors,
        }


# ── entrypoint ────────────────────────────────────────────────────────────────

def main():
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        sys.stdout.write(json.dumps({"ok": False, "error": f"JSON inválido: {e}"}))
        sys.exit(1)

    loader = DrakeTaxLoader(payload)
    result = loader.run()
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()
    # Force-exit to kill any daemon threads stuck in COM calls (they can't be
    # interrupted by Python's normal shutdown, causing the process to hang on exit).
    import os
    os._exit(0)


if __name__ == "__main__":
    main()
