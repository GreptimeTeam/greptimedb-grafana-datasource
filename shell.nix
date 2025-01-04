let
  nixpkgs = fetchTarball "https://github.com/NixOS/nixpkgs/tarball/nixos-24.11";
  pkgs = import nixpkgs { config = {}; overlays = []; };
in

pkgs.mkShell rec {
  nativeBuildInputs = with pkgs; [
    git
    go
    nodejs
    zip
    yarn
    mage
    podman
  ];

  buildInputs = with pkgs; [
  ];

  LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath buildInputs;
}
