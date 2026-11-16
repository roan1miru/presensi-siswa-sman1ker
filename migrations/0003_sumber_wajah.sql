-- Asal data wajah: 'camera' (pendaftaran langsung) atau 'photo' (dari foto kartu pelajar).
ALTER TABLE face_profiles ADD COLUMN source TEXT NOT NULL DEFAULT 'camera';
