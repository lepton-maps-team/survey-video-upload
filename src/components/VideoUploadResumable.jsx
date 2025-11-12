import { useState, useRef } from "react";

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100MB
const CONCURRENCY = 4;
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

  const saveUploadProgress = (surveyId, fileName, data, filePath = "") => {
    const surveyStorageKey = getSurveyStorageKey(surveyId);
    const uploads = JSON.parse(localStorage.getItem(surveyStorageKey) || "{}");
    uploads[getStorageKey(surveyId, fileName)] = { ...data, filePath };
    localStorage.setItem(surveyStorageKey, JSON.stringify(uploads));
  };

  const clearUploadRecord = (surveyId, fileName) => {
    const surveyStorageKey = getSurveyStorageKey(surveyId);
    const uploads = JSON.parse(localStorage.getItem(surveyStorageKey) || "{}");
    delete uploads[getStorageKey(surveyId, fileName)];
    localStorage.setItem(surveyStorageKey, JSON.stringify(uploads));
  };

  // ------------------ FILE SELECTION ------------------
  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    setUploadProgress(0);
    setCanceled(false);

    const saved = loadSavedUpload(surveyId, selectedFile.name);
    if (saved) {
      // Restore meta info to file object
      selectedFile.meta = {
        dateTimestamp: saved.dateTimestamp || new Date().toISOString(),
        fileSizeBytes: saved.fileSizeBytes || selectedFile.size,
      };
      console.log("Previous upload path:", saved.filePath);
    }
  };

  // ------------------ EDGE HELPERS ------------------
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
    const fileSizeBytes = file?.meta?.fileSizeBytes || file.size;
    const dateTimestamp = file?.meta?.dateTimestamp || new Date().toISOString();

    const body = await postEdge({
      fileName: objectName,
      fileSizeBytes,
      fileType: file.type,
      dateTimestamp,
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
      dateTimestamp: file?.meta?.dateTimestamp || new Date().toISOString(),
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
      // Single PUT
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

        saveUploadProgress(
          surveyId,
          file.name,
          {},
          folder ? `${folder}/${file.name}` : file.name,
        );
        onUploadComplete(
          surveyId,
          file.name,
          url.split(".com/")[1].split(".mp4")[0] + ".mp4",
        );
        return;
      }

      // Multipart
      let uploadData = loadSavedUpload(surveyId, file.name);
      if (!uploadData) {
        uploadData = await createMultipartUpload(file);
        saveUploadProgress(
          surveyId,
          file.name,
          { ...uploadData, parts: [] },
          folder ? `${folder}/${file.name}` : file.name,
        );
      }

      const uploadedPartNumbers = new Set(
        (uploadData?.parts ?? []).map((p) => p.PartNumber),
      );
      const totalParts = Math.ceil(file.size / CHUNK_SIZE);
      const parts = [...(uploadData.parts || [])];
      setUploadProgress(
        Math.round((uploadedPartNumbers.size / totalParts) * 100),
      );

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
            saveUploadProgress(
              surveyId,
              file.name,
              { ...uploadData, parts },
              folder ? `${folder}/${file.name}` : file.name,
            );
          } else if (!canceled) {
            console.error("❌ Chunk upload failed:", r.reason);
            throw r.reason;
          }
        }

        setUploadProgress(Math.round((parts.length / totalParts) * 100));
      }

      if (canceled) throw new Error("Upload canceled by user");

      const completed = await completeMultipartUpload(file, {
        uploadId: uploadData.uploadId,
        parts,
      });
      saveUploadProgress(
        surveyId,
        file.name,
        { ...uploadData, parts },
        folder ? `${folder}/${file.name}` : file.name,
      );

      onUploadComplete(
        surveyId,
        file.name,
        completed.location.split(".com/")[1].split(".mp4")[0] + ".mp4",
      );
      clearUploadRecord(surveyId, file.name);
      console.log("✅ Multipart upload complete:", completed);
    } catch (err) {
      if (err.name === "AbortError") console.log("🚫 Upload aborted.");
      else console.error("❌ Upload failed:", err);
    } finally {
      setUploading(false);
      abortControllers.current = [];
    }
  };

  // ------------------ UI ------------------
  return (
    <div
      style={{
        padding: "20px",
        maxWidth: 480,
        margin: "40px auto",
        borderRadius: "12px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
        background: "#fff",
        fontFamily: "Inter, sans-serif",
        textAlign: "center",
      }}
    >
      <label
        style={{
          display: "block",
          border: "2px dashed #ccc",
          borderRadius: "10px",
          padding: "30px",
          cursor: "pointer",
          transition: "0.3s",
        }}
      >
        {file ? (
          <strong>{file.name}</strong>
        ) : (
          <span style={{ color: "#888" }}>Click to choose a video file</span>
        )}
        <input
          type="file"
          accept="video/*"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
      </label>

      <div style={{ marginTop: 10 }}>
        <button
          disabled={!file || uploading}
          onClick={handleUpload}
          style={{
            background: uploading ? "#ccc" : "#4caf50",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: uploading ? "not-allowed" : "pointer",
            fontWeight: 600,
            fontSize: "14px",
            transition: "background 0.3s ease",
          }}
        >
          {uploading ? "Uploading..." : "Start Upload"}
        </button>

        {uploading && (
          <button
            onClick={handleCancel}
            style={{
              marginLeft: "10px",
              background: "#f44336",
              color: "white",
              border: "none",
              padding: "10px 18px",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "14px",
            }}
          >
            Cancel
          </button>
        )}
      </div>

      {uploading && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontWeight: 500 }}>Progress: {uploadProgress}%</div>
          <div
            style={{
              height: "12px",
              width: "100%",
              background: "#eee",
              borderRadius: "8px",
              marginTop: "8px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "12px",
                width: `${uploadProgress}%`,
                background: canceled ? "#999" : "#4caf50",
                borderRadius: "8px",
                transition: "width 0.3s ease",
              }}
            ></div>
          </div>
        </div>
      )}

      {canceled && (
        <div style={{ color: "red", marginTop: "12px", fontWeight: 500 }}>
          Upload canceled by user.
        </div>
      )}
    </div>
  );
};

export default VideoUploadResumable;
