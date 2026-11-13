MESOB - START BY ITSELF (Windows)

Does the website run while the PC sleeps?
  No. A sleeping PC is switched off for everyone else - nobody can open the site until it wakes.
  So install-autostart.bat turns sleep OFF while the PC is plugged in (the screen may still turn off).
  If the PC does sleep (battery, or someone puts it to sleep), the site comes back by itself when it wakes up.

One time only
1. Close any old Mesob window that is open (the black window).
2. Right-click install-autostart.bat -> Run as administrator.
3. Press Enter for port 8080 (or type another port). Type the QMS login if asked (Enter to skip).
   Optional: the live MESOB data login (Enter to skip).

After that, the website starts by itself:
  - when the computer starts (nobody has to log in),
  - when it wakes up from sleep,
  - when the network connects again,
  - and it restarts itself if it ever stops. Only one copy ever runs.

Address for everyone on the network:  http://THIS-COMPUTER-IP:8080   (the IP is shown by:  ipconfig )

Check it any time: double-click check-autostart.bat
To change the port or logins: run install-autostart.bat again.
To remove: run uninstall-autostart.bat (as administrator).
Logins are stored in qms.env, readable only by Windows administrators.
Branches: edit branches.json to add or rename branches (name + code), then refresh the page.
