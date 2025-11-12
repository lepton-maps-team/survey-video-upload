import { useState } from "react";

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100MB
const EDGE_FUNCTION_URL = import.meta.env.VITE_EDGE_FUNCTION;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const STORAGE_KEY_BASE = "resumable_uploads_v2";

const VideoUploadResumable = ({
  surveyId,
  onUploadComplete,
  accessToken,
  folder = "",
}) => {
  const [file, setFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);

  // ✅ Generate per-survey localStorage key
  const getSurveyStorageKey = (surveyId) =>
    `${STORAGE_KEY_BASE}_${surveyId || "default"}`;

  const getStorageKey = (surveyId, fileName) =>
    `${surveyId || "default"}::${fileName}`;

  // ------------------ LOCAL STORAGE HELPERS ------------------

  const loadSavedUpload = (surveyId, fileName) => {
    const surveyStorageKey = getSurveyStorageKey(surveyId);
    const uploads = JSON.parse(localStorage.getItem(surveyStorageKey) || "{}");
    const key = getStorageKey(surveyId, fileName);
    return uploads[key];
  };

  const saveUploadProgress = (surveyId, fileName, data) => {
    const surveyStorageKey = getSurveyStorageKey(surveyId);
    const uploads = JSON.parse(localStorage.getItem(surveyStorageKey) || "{}");
    const key = getStorageKey(surveyId, fileName);
    uploads[key] = data;
    localStorage.setItem(surveyStorageKey, JSON.stringify(uploads));
  };

  const clearUploadRecord = (surveyId, fileName) => {
    const surveyStorageKey = getSurveyStorageKey(surveyId);
    const uploads = JSON.parse(localStorage.getItem(surveyStorageKey) || "{}");
    const key = getStorageKey(surveyId, fileName);
    delete uploads[key];
    localStorage.setItem(surveyStorageKey, JSON.stringify(uploads));
  };

  // ------------------ FILE CHANGE ------------------

  const handleFileChange = (event) => {
    setFile(event.target.files[0]);
  };

  // ------------------ EDGE FUNCTION HELPERS ------------------

  const getUploadParameters = async (file) => {
    const ts = new Date().toISOString();
    const objectName = folder ? `${folder}/${file.name}` : file.name;

    const resp = await fetch(EDGE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        fileName: objectName,
        fileSizeBytes: file.size,
        fileType: file.type,
        dateTimestamp: ts,
      }),
    });

    if (!resp.ok)
      throw new Error(
        `Init (single) failed: ${resp.status} ${await resp.text()}`,
      );

    const body = await resp.json();
    file.meta = { dateTimestamp: ts, fileSizeBytes: file.size };
    return {
      method: "PUT",
      url: body.uploadUrl,
      headers: { "Content-Type": file.type },
    };
  };

  const createMultipartUpload = async (file) => {
    const ts = new Date().toISOString();
    const objectName = folder ? `${folder}/${file.name}` : file.name;

    const resp = await fetch(EDGE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        fileName: objectName,
        fileSizeBytes: file.size,
        fileType: file.type,
        dateTimestamp: ts,
      }),
    });

    if (!resp.ok)
      throw new Error(
        `Init (multipart) failed: ${resp.status} ${await resp.text()}`,
      );

    const body = await resp.json();
    file.meta = { dateTimestamp: ts, fileSizeBytes: file.size };
    return { uploadId: body.uploadId, key: body.fileKey };
  };

  const signPart = async (file, { uploadId, partNumber }) => {
    const objectName = folder ? `${folder}/${file.name}` : file.name;

    const resp = await fetch(EDGE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        fileName: objectName,
        fileSizeBytes: file.meta.fileSizeBytes || file.size,
        fileType: file.type,
        dateTimestamp: file.meta.dateTimestamp,
        partNumber,
        uploadId,
      }),
    });

    if (!resp.ok)
      throw new Error(
        `Sign part ${partNumber} failed: ${resp.status} ${await resp.text()}`,
      );

    const body = await resp.json();
    return { url: body.uploadUrl };
  };

  const completeMultipartUpload = async (file, uploadData) => {
    const objectName = folder ? `${folder}/${file.name}` : file.name;
    const totalChunks = Math.ceil(
      (file.meta.fileSizeBytes || file.size) / CHUNK_SIZE,
    );

    const resp = await fetch(EDGE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        fileName: objectName,
        fileSizeBytes: file.meta.fileSizeBytes || file.size,
        fileType: file.type,
        dateTimestamp: file.meta.dateTimestamp,
        partNumber: totalChunks + 1,
        uploadId: uploadData.uploadId,
        parts: uploadData.parts,
      }),
    });

    if (!resp.ok)
      throw new Error(`Complete failed: ${resp.status} ${await resp.text()}`);

    const body = await resp.json();
    return { location: body.location };
  };

  // ------------------ UPLOAD HANDLER ------------------

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);

    try {
      if (file.size < MULTIPART_THRESHOLD) {
        // --- Single upload ---
        const { url, headers } = await getUploadParameters(file);
        const resp = await fetch(url, { method: "PUT", headers, body: file });
        if (!resp.ok) throw new Error(`Upload failed: ${resp.statusText}`);

        // ✅ Clear local record & callback
        clearUploadRecord(surveyId, file.name);
        onUploadComplete(
          surveyId,
          file.name,
          url.split(".com/")[1].split(".mp4")[0] + ".mp4",
        );
      } else {
        // --- Multipart upload ---
        let saved = loadSavedUpload(surveyId, file.name);
        let uploadData;

        if (saved) {
          console.log("🔄 Resuming upload:", saved);
          uploadData = saved;
          if (!file.meta) {
            file.meta = {
              fileSizeBytes: file.size,
              fileType: file.type,
              dateTimestamp: new Date().toISOString(),
            };
          }
        } else {
          uploadData = await createMultipartUpload(file);
          saveUploadProgress(surveyId, file.name, { ...uploadData, parts: [] });
        }

        const uploadedPartNumbers = new Set(
          (uploadData?.parts ?? []).map((p) => p.PartNumber),
        );

        const totalParts = Math.ceil(file.size / CHUNK_SIZE);
        const parts = [...uploadData.parts];

        setUploadProgress(
          Math.round((uploadedPartNumbers.size / totalParts) * 100),
        );

        for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
          if (uploadedPartNumbers.has(partNumber)) continue;

          const start = (partNumber - 1) * CHUNK_SIZE;
          const end = Math.min(partNumber * CHUNK_SIZE, file.size);
          const blob = file.slice(start, end);

          const { url } = await signPart(file, {
            uploadId: uploadData.uploadId,
            partNumber,
          });
          const resp = await fetch(url, {
            method: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
            body: blob,
          });

          if (!resp.ok) throw new Error(`Part ${partNumber} failed`);

          const eTag = resp.headers.get("ETag")?.replaceAll('"', "");
          parts.push({ ETag: eTag, PartNumber: partNumber });

          saveUploadProgress(surveyId, file.name, { ...uploadData, parts });
          setUploadProgress(Math.round((partNumber / totalParts) * 100));
        }

        const completed = await completeMultipartUpload(file, {
          uploadId: uploadData.uploadId,
          parts,
        });

        // ✅ Remove completed record and call consistent callback
        clearUploadRecord(surveyId, file.name);
        onUploadComplete(
          surveyId,
          file.name,
          completed.location.split(".com/")[1].split(".mp4")[0] + ".mp4",
        );

        console.log("✅ Multipart upload complete:", completed);
      }
    } catch (err) {
      console.error("❌ Upload failed:", err);
    } finally {
      setUploading(false);
    }
  };

  // ------------------ UI ------------------

  return (
    <div style={{ padding: "16px", maxWidth: 480 }}>
      <input type="file" onChange={handleFileChange} />
      <button disabled={!file || uploading} onClick={handleUpload}>
        {uploading ? "Uploading..." : "Upload"}
      </button>

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
                background: "#4caf50",
                borderRadius: "4px",
              }}
            ></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoUploadResumable;
