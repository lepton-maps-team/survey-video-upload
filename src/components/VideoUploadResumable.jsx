import { useState, useRef } from "react";

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100MB
const CONCURRENCY = 4; // number of parallel uploads per batch
const EDGE_FUNCTION_URL = import.meta.env.VITE_EDGE_FUNCTION;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const STORAGE_KEY_BASE = "resumable_uploads_v2";

const VideoUploadResumable = ({ surveyId, onUploadComplete, folder = "" }) => {
  const [file, setFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [canceled, setCanceled] = useState(false);
  const abortControllers = useRef([]);

  // ------------------ STORAGE HELPERS ------------------
  const getSurveyStorageKey = (surveyId) =>
    `${STORAGE_KEY_BASE}_${surveyId || "default"}`;

  const getStorageKey = (surveyId, fileName) =>
    `${surveyId || "default"}::${fileName}`;

  const loadSavedUpload = (surveyId, fileName) => {
    const surveyStorageKey = getSurveyStorageKey(surveyId);
    const uploads = JSON.parse(localStorage.getItem(surveyStorageKey) || "{}");
    return uploads[getStorageKey(surveyId, fileName)];
  };

  const saveUploadProgress = (surveyId, fileName, data) => {
    const surveyStorageKey = getSurveyStorageKey(surveyId);
    const uploads = JSON.parse(localStorage.getItem(surveyStorageKey) || "{}");
    uploads[getStorageKey(surveyId, fileName)] = data;
    localStorage.setItem(surveyStorageKey, JSON.stringify(uploads));
  };

  const clearUploadRecord = (surveyId, fileName) => {
    const surveyStorageKey = getSurveyStorageKey(surveyId);
    const uploads = JSON.parse(localStorage.getItem(surveyStorageKey) || "{}");
    delete uploads[getStorageKey(surveyId, fileName)];
    localStorage.setItem(surveyStorageKey, JSON.stringify(uploads));
  };

  // ------------------ FILE CHANGE ------------------
  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setUploadProgress(0);
    setCanceled(false);
  };

  // ------------------ EDGE FUNCTION HELPERS ------------------
  const postEdge = async (bodyObj) => {
    const resp = await fetch(EDGE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(bodyObj),
    });
    if (!resp.ok) throw new Error(await resp.text());
    return resp.json();
  };

  const getUploadParameters = async (file) => {
    const ts = new Date().toISOString();
    const objectName = folder ? `${folder}/${file.name}` : file.name;
    const body = await postEdge({
      fileName: objectName,
      fileSizeBytes: file.size,
      fileType: file.type,
      dateTimestamp: ts,
    });
    file.meta = { dateTimestamp: ts, fileSizeBytes: file.size };
    return { url: body.uploadUrl, headers: { "Content-Type": file.type } };
  };

  const createMultipartUpload = async (file) => {
    const ts = new Date().toISOString();
    const objectName = folder ? `${folder}/${file.name}` : file.name;
    const body = await postEdge({
      fileName: objectName,
      fileSizeBytes: file.size,
      fileType: file.type,
      dateTimestamp: ts,
    });
    file.meta = { dateTimestamp: ts, fileSizeBytes: file.size };
    return { uploadId: body.uploadId, key: body.fileKey };
  };

  const signPart = async (file, { uploadId, partNumber }) => {
    const objectName = folder ? `${folder}/${file.name}` : file.name;
    const body = await postEdge({
      fileName: objectName,
      fileSizeBytes: file.meta.fileSizeBytes || file.size,
      fileType: file.type,
      dateTimestamp: file.meta.dateTimestamp,
      partNumber,
      uploadId,
    });
    return { url: body.uploadUrl };
  };

  const completeMultipartUpload = async (file, uploadData) => {
    const objectName = folder ? `${folder}/${file.name}` : file.name;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const body = await postEdge({
      fileName: objectName,
      fileSizeBytes: file.size,
      fileType: file.type,
      dateTimestamp: file.meta.dateTimestamp,
      partNumber: totalChunks + 1,
      uploadId: uploadData.uploadId,
      parts: uploadData.parts,
    });
    return { location: body.location };
  };

  // ------------------ CANCEL HANDLER ------------------
  const handleCancel = () => {
    setCanceled(true);
    abortControllers.current.forEach((ctrl) => ctrl.abort());
    abortControllers.current = [];
    setUploading(false);
  };

  // ------------------ UPLOAD HANDLER ------------------
  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setCanceled(false);

    try {
      // -------- Small File (Single PUT) --------
      if (file.size < MULTIPART_THRESHOLD) {
        const { url, headers } = await getUploadParameters(file);
        const controller = new AbortController();
        abortControllers.current.push(controller);
        const resp = await fetch(url, {
          method: "PUT",
          headers,
          body: file,
          signal: controller.signal,
        });
        if (!resp.ok) throw new Error(`Upload failed: ${resp.statusText}`);
        clearUploadRecord(surveyId, file.name);
        onUploadComplete(
          surveyId,
          file.name,
          url.split(".com/")[1].split(".mp4")[0] + ".mp4",
        );
        return;
      }

      // -------- Multipart Upload --------
      let uploadData = loadSavedUpload(surveyId, file.name);
      if (!uploadData) {
        uploadData = await createMultipartUpload(file);
        saveUploadProgress(surveyId, file.name, { ...uploadData, parts: [] });
      }

      const uploadedPartNumbers = new Set(
        (uploadData?.parts ?? []).map((p) => p.PartNumber),
      );
      const totalParts = Math.ceil(file.size / CHUNK_SIZE);
      const parts = [...(uploadData.parts || [])];

      setUploadProgress(
        Math.round((uploadedPartNumbers.size / totalParts) * 100),
      );

      // 🚀 Parallel upload batches with cancel support
      for (let i = 1; i <= totalParts; i += CONCURRENCY) {
        if (canceled) throw new Error("Upload canceled by user");

        const batch = [];
        for (let j = i; j < i + CONCURRENCY && j <= totalParts; j++) {
          if (uploadedPartNumbers.has(j)) continue;

          const start = (j - 1) * CHUNK_SIZE;
          const end = Math.min(j * CHUNK_SIZE, file.size);
          const blob = file.slice(start, end);

          batch.push(
            (async () => {
              const { url } = await signPart(file, {
                uploadId: uploadData.uploadId,
                partNumber: j,
              });
              const controller = new AbortController();
              abortControllers.current.push(controller);
              const resp = await fetch(url, {
                method: "PUT",
                headers: { "Content-Type": "application/octet-stream" },
                body: blob,
                signal: controller.signal,
              });
              if (!resp.ok) throw new Error(`Part ${j} failed`);
              const eTag = resp.headers.get("ETag")?.replaceAll('"', "");
              return { ETag: eTag, PartNumber: j };
            })(),
          );
        }

        const results = await Promise.allSettled(batch);
        for (const r of results) {
          if (r.status === "fulfilled") {
            parts.push(r.value);
            saveUploadProgress(surveyId, file.name, { ...uploadData, parts });
          } else if (!canceled) {
            console.error("❌ Chunk upload failed:", r.reason);
            throw r.reason;
          }
        }

        setUploadProgress(Math.round((parts.length / totalParts) * 100));
      }

      if (canceled) throw new Error("Upload canceled by user");

      // ✅ Complete upload
      const completed = await completeMultipartUpload(file, {
        uploadId: uploadData.uploadId,
        parts,
      });
      clearUploadRecord(surveyId, file.name);

      onUploadComplete(
        surveyId,
        file.name,
        completed.location.split(".com/")[1].split(".mp4")[0] + ".mp4",
      );
      console.log("✅ Multipart upload complete:", completed);
    } catch (err) {
      if (err.name === "AbortError") {
        console.log("🚫 Upload aborted.");
      } else {
        console.error("❌ Upload failed:", err);
      }
    } finally {
      setUploading(false);
      abortControllers.current = [];
    }
  };

  // ------------------ UI ------------------
  return (
    <div style={{ padding: "16px", maxWidth: 480 }}>
      <input type="file" onChange={handleFileChange} />
      <div style={{ marginTop: "12px" }}>
        <button disabled={!file || uploading} onClick={handleUpload}>
          {uploading ? "Uploading..." : "Upload"}
        </button>
        {uploading && (
          <button
            onClick={handleCancel}
            style={{
              marginLeft: "10px",
              background: "#f44336",
              color: "white",
              border: "none",
              padding: "6px 12px",
              borderRadius: "4px",
            }}
          >
            Cancel
          </button>
        )}
      </div>

      {uploading && (
        <div style={{ marginTop: "10px" }}>
          Progress: {uploadProgress}%
          <div
            style={{
              height: "10px",
              width: "100%",
              background: "#eee",
              borderRadius: "4px",
              marginTop: "4px",
            }}
          >
            <div
              style={{
                height: "10px",
                width: `${uploadProgress}%`,
                background: canceled ? "#999" : "#4caf50",
                borderRadius: "4px",
                transition: "width 0.3s ease",
              }}
            ></div>
          </div>
        </div>
      )}

      {canceled && (
        <div style={{ color: "red", marginTop: "8px" }}>
          Upload canceled by user.
        </div>
      )}
    </div>
  );
};

export default VideoUploadResumable;
